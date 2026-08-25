import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CHUNKER_VERSION, chunkKnowledgeText, type KnowledgeChunk } from "./chunker.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const MAX_BATCH_SIZE = 2;

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
  document_id: string;
  extracted_text: string;
  extraction_checksum_sha256: string;
  chunking_attempts: number;
};

type KnowledgeVersionRow = {
  id: string;
  organization_id: string;
  extraction_status: string;
  chunking_status: string;
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
      claim_knowledge_document_chunking: {
        Args: {
          target_version_id: string;
          target_chunking_token: string;
          target_chunker_version: string;
        };
        Returns: ClaimedVersion[];
      };
      complete_knowledge_document_chunking: {
        Args: {
          target_version_id: string;
          target_chunking_token: string;
          target_chunker_version: string;
          target_chunks: KnowledgeChunk[];
        };
        Returns: boolean;
      };
      fail_knowledge_document_chunking: {
        Args: {
          target_version_id: string;
          target_chunking_token: string;
          target_error: string;
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

async function processVersion(supabaseAdmin: SupabaseClient<Database>, versionId: string) {
  const chunkingToken = crypto.randomUUID();
  const { data: claim, error: claimError } = await supabaseAdmin
    .rpc("claim_knowledge_document_chunking", {
      target_version_id: versionId,
      target_chunking_token: chunkingToken,
      target_chunker_version: CHUNKER_VERSION,
    })
    .maybeSingle();

  if (claimError) throw claimError;
  if (!claim) return;

  try {
    const chunks = await chunkKnowledgeText(claim.extracted_text);
    const { data: completed, error: completeError } = await supabaseAdmin.rpc(
      "complete_knowledge_document_chunking",
      {
        target_version_id: claim.version_id,
        target_chunking_token: chunkingToken,
        target_chunker_version: CHUNKER_VERSION,
        target_chunks: chunks,
      },
    );
    if (completeError) throw completeError;
    if (!completed) throw new Error("Chunking lease expired before completion.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown chunking error";
    const { error: failError } = await supabaseAdmin.rpc("fail_knowledge_document_chunking", {
      target_version_id: claim.version_id,
      target_chunking_token: chunkingToken,
      target_error: message,
    });
    if (failError) console.error("Could not persist chunking failure", claim.version_id, failError.message);
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
      .select("id, organization_id, extraction_status, chunking_status")
      .in("id", versionIds);
    if (versionsError) throw versionsError;
    if ((versions || []).length !== versionIds.length) return json(404, { error: "version_not_found" });
    if ((versions || []).some((version) => version.extraction_status !== "completed")) {
      return json(409, { error: "extraction_not_completed" });
    }

    const organizationIds = [...new Set((versions || []).map((version) => version.organization_id))];
    for (const organizationId of organizationIds) {
      const { data: allowed, error: accessError } = await userClient.rpc("can_manage_organization", {
        target_organization_id: organizationId,
      });
      if (accessError || !allowed) return json(403, { error: "not_authorized" });
    }

    EdgeRuntime.waitUntil(processBatch(versionIds));
    return json(202, { accepted: versionIds.length, versionIds, chunkerVersion: CHUNKER_VERSION });
  } catch (error) {
    console.error("Knowledge chunking request failed", error instanceof Error ? error.message : error);
    return json(400, { error: error instanceof Error ? error.message : "invalid_request" });
  }
});
