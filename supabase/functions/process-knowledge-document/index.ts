import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import mammoth from "mammoth";
import { Buffer } from "node:buffer";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const EXTRACTOR_VERSION = "orvesen-text-v1";
const MAX_BATCH_SIZE = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 5_000_000;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

type VersionRequest = {
  version_id?: string;
  version_ids?: string[];
};

type ClaimedVersion = {
  version_id: string;
  organization_id: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  processing_attempts: number;
};

type KnowledgeVersionRow = {
  id: string;
  organization_id: string;
  checksum_sha256: string | null;
  extraction_status: string;
  extracted_text: string | null;
  extractor_version: string | null;
};

type Database = {
  public: {
    Tables: {
      knowledge_document_versions: {
        Row: KnowledgeVersionRow;
        Insert: Partial<KnowledgeVersionRow>;
        Update: Partial<KnowledgeVersionRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      can_manage_organization: {
        Args: { target_organization_id: string };
        Returns: boolean;
      };
      claim_knowledge_document_extraction: {
        Args: { target_version_id: string; target_processing_token: string };
        Returns: ClaimedVersion[];
      };
      complete_knowledge_document_extraction: {
        Args: {
          target_version_id: string;
          target_processing_token: string;
          target_checksum_sha256: string;
          target_extracted_text: string;
          target_extractor_version: string;
        };
        Returns: boolean;
      };
      fail_knowledge_document_extraction: {
        Args: {
          target_version_id: string;
          target_processing_token: string;
          target_error: string;
          target_checksum_sha256: string | null;
        };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

function requiredSecret(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

function serviceKey() {
  const modernKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modernKeys) {
    const parsed = JSON.parse(modernKeys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  return requiredSecret("SUPABASE_SERVICE_ROLE_KEY");
}

function parseVersionIds(payload: VersionRequest) {
  const candidates = [payload.version_id, ...(payload.version_ids || [])].filter(Boolean) as string[];
  const ids = [...new Set(candidates)];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!ids.length || ids.length > MAX_BATCH_SIZE || ids.some((id) => !uuidPattern.test(id))) {
    throw new Error(`Provide between 1 and ${MAX_BATCH_SIZE} valid version IDs.`);
  }
  return ids;
}

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizedText(value: string) {
  const normalized = value.replace(/\0/g, "").replace(/\r\n?/g, "\n").trim();
  if (normalized.length > MAX_TEXT_CHARACTERS) {
    throw new Error(`Extracted text exceeds ${MAX_TEXT_CHARACTERS} characters.`);
  }
  return normalized;
}

async function extractText(file: ClaimedVersion, buffer: ArrayBuffer) {
  const mimeType = (file.mime_type || "").toLowerCase();
  const extension = file.file_name.split(".").pop()?.toLowerCase() || "";

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || extension === "docx") {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    return normalizedText(result.value);
  }

  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (mimeType === "application/json" || extension === "json") {
    return normalizedText(JSON.stringify(JSON.parse(decoded), null, 2));
  }
  if (mimeType === "text/plain" || mimeType === "text/csv" || extension === "txt" || extension === "csv") {
    return normalizedText(decoded);
  }

  throw new Error(`Unsupported format: ${mimeType || extension || "unknown"}`);
}

async function processVersion(supabaseAdmin: SupabaseClient<Database>, versionId: string) {
  const processingToken = crypto.randomUUID();
  const { data: claim, error: claimError } = await supabaseAdmin
    .rpc("claim_knowledge_document_extraction", {
      target_version_id: versionId,
      target_processing_token: processingToken,
    })
    .maybeSingle();

  if (claimError) throw claimError;
  if (!claim) return;

  let checksum: string | null = null;
  try {
    if (claim.file_size !== null && claim.file_size > MAX_FILE_BYTES) {
      throw new Error(`File exceeds the extraction limit of ${MAX_FILE_BYTES} bytes.`);
    }

    const { data: object, error: downloadError } = await supabaseAdmin.storage
      .from("knowledge-base")
      .download(claim.file_path);
    if (downloadError || !object) throw downloadError || new Error("Storage object not found.");

    const buffer = await object.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new Error(`File exceeds the extraction limit of ${MAX_FILE_BYTES} bytes.`);
    }

    checksum = await sha256(buffer);
    const { data: reusable, error: reusableError } = await supabaseAdmin
      .from("knowledge_document_versions")
      .select("extracted_text, extractor_version")
      .eq("organization_id", claim.organization_id)
      .eq("checksum_sha256", checksum)
      .eq("extraction_status", "completed")
      .neq("id", claim.version_id)
      .limit(1)
      .maybeSingle<{ extracted_text: string; extractor_version: string }>();
    if (reusableError) throw reusableError;

    const text = reusable?.extracted_text ?? await extractText(claim, buffer);
    const extractorVersion = reusable?.extractor_version || EXTRACTOR_VERSION;
    const { data: completed, error: completeError } = await supabaseAdmin.rpc(
      "complete_knowledge_document_extraction",
      {
        target_version_id: claim.version_id,
        target_processing_token: processingToken,
        target_checksum_sha256: checksum,
        target_extracted_text: text,
        target_extractor_version: extractorVersion,
      },
    );
    if (completeError) throw completeError;
    if (!completed) throw new Error("Extraction lease expired before completion.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown extraction error";
    const { error: failError } = await supabaseAdmin.rpc("fail_knowledge_document_extraction", {
      target_version_id: claim.version_id,
      target_processing_token: processingToken,
      target_error: message,
      target_checksum_sha256: checksum,
    });
    if (failError) console.error("Could not persist extraction failure", claim.version_id, failError.message);
  }
}

async function processBatch(versionIds: string[]) {
  const supabaseAdmin = createClient<Database>(requiredSecret("SUPABASE_URL"), serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const versionId of versionIds) await processVersion(supabaseAdmin, versionId);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });

  try {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json(401, { error: "missing_authorization" });

    const supabaseUrl = requiredSecret("SUPABASE_URL");
    const userClient = createClient<Database>(supabaseUrl, requiredSecret("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser(token);
    if (userError || !user) return json(401, { error: "invalid_session" });

    const versionIds = parseVersionIds(await request.json() as VersionRequest);
    const { data: versions, error: versionsError } = await userClient
      .from("knowledge_document_versions")
      .select("id, organization_id")
      .in("id", versionIds);
    if (versionsError) throw versionsError;
    if ((versions || []).length !== versionIds.length) return json(404, { error: "version_not_found" });

    const organizationIds = [...new Set((versions || []).map((version) => version.organization_id))];
    for (const organizationId of organizationIds) {
      const { data: allowed, error: accessError } = await userClient.rpc("can_manage_organization", {
        target_organization_id: organizationId,
      });
      if (accessError || !allowed) return json(403, { error: "not_authorized" });
    }

    EdgeRuntime.waitUntil(processBatch(versionIds));
    return json(202, { accepted: versionIds.length, versionIds });
  } catch (error) {
    console.error("Knowledge extraction request failed", error instanceof Error ? error.message : error);
    return json(400, { error: error instanceof Error ? error.message : "invalid_request" });
  }
});
