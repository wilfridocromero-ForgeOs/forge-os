import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  boundedInteger,
  buildLimitedHistory,
  orbEvent,
  OrbRequestError,
  parseOrbChatRequest,
  publicError,
  sanitizeErrorCode,
} from "./protocol.ts";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};

const streamHeaders = {
  ...corsHeaders,
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
};

const ORB_INSTRUCTIONS_VERSION = "orb-v1-2026-08-25";
const ORB_INSTRUCTIONS =
  `Eres Orb, el asistente inteligente de ORVESEN. Ayudas a comprender y operar la organización usando únicamente información disponible y autorizada. Distingue hechos, inferencias y propuestas. No inventes datos ni afirmes haber consultado módulos o herramientas que no estén disponibles. Explica claramente las limitaciones y respeta siempre los permisos del usuario. Actualmente no tienes herramientas activas ni acceso a Cerebro, Clientes, Discovery, Score, Proyectos, Calendario o Ventas.`;

type TurnRecord = {
  organization_id: string;
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  assistant_status: string;
  assistant_content: string;
  membership_role: string;
  was_created: boolean;
};

type OpenAIEvent = {
  type?: string;
  delta?: string;
  response?: { id?: string; error?: { code?: string } };
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function requiredSecret(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new OrbRequestError(
      "AI_NOT_CONFIGURED",
      503,
      "Orb is not configured yet.",
    );
  }
  return value;
}

export function readOpenAIKey() {
  return requiredSecret("OPENAI_API_KEY");
}

function serviceKey() {
  const modernKeys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modernKeys) {
    try {
      const parsed = JSON.parse(modernKeys) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {
      throw new OrbRequestError(
        "BACKEND_NOT_CONFIGURED",
        503,
        "Orb backend is not configured.",
      );
    }
  }
  const legacyKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacyKey) {
    throw new OrbRequestError(
      "BACKEND_NOT_CONFIGURED",
      503,
      "Orb backend is not configured.",
    );
  }
  return legacyKey;
}

function providerConfiguration() {
  const provider = (Deno.env.get("ORB_AI_PROVIDER") || "openai").trim()
    .toLowerCase();
  if (provider !== "openai") {
    throw new OrbRequestError(
      "AI_PROVIDER_UNSUPPORTED",
      503,
      "Orb provider is not supported.",
    );
  }
  return {
    provider,
    model: (Deno.env.get("ORB_AI_MODEL") || "gpt-5.4-mini").trim(),
    maxOutputTokens: boundedInteger(
      Deno.env.get("ORB_MAX_OUTPUT_TOKENS"),
      800,
      128,
      2_000,
    ),
    timeoutMs: boundedInteger(
      Deno.env.get("ORB_TIMEOUT_MS"),
      45_000,
      5_000,
      90_000,
    ),
  };
}

async function privacyPreservingUserId(userId: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`orvesen-orb:${userId}`),
  );
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function consumeOpenAIStream(
  response: Response,
  onDelta: (delta: string) => void,
  onResponseId: (responseId: string) => void,
) {
  if (!response.ok || !response.body) {
    throw new OrbRequestError(
      response.status === 429 ? "AI_RATE_LIMITED" : "AI_PROVIDER_ERROR",
      502,
      "Orb could not obtain a model response.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const data = block.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      let event: OpenAIEvent;
      try {
        event = JSON.parse(data) as OpenAIEvent;
      } catch {
        continue;
      }
      if (event.response?.id) onResponseId(event.response.id);
      if (
        event.type === "response.output_text.delta" &&
        typeof event.delta === "string"
      ) {
        onDelta(event.delta);
      }
      if (event.type === "response.failed") {
        throw new OrbRequestError(
          sanitizeErrorCode(event.response?.error?.code, "AI_PROVIDER_ERROR"),
          502,
          "Orb could not obtain a model response.",
        );
      }
    }
    if (done) break;
  }
}

export async function handleOrbChat(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json(405, { error: "METHOD_NOT_ALLOWED" });
  }

  let assistantMessageId: string | null = null;
  let processingToken: string | null = null;
  let adminClient: SupabaseClient | null = null;

  try {
    const authorization = request.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) {
      throw new OrbRequestError(
        "AUTH_REQUIRED",
        401,
        "Authentication is required.",
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      throw new OrbRequestError(
        "BACKEND_NOT_CONFIGURED",
        503,
        "Orb backend is not configured.",
      );
    }

    const payload = parseOrbChatRequest(await request.json());
    const config = providerConfiguration();

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser(
      token,
    );
    if (userError || !user) {
      throw new OrbRequestError("INVALID_SESSION", 401, "Session is invalid.");
    }

    const { data: context, error: contextError } = await userClient.rpc(
      "get_my_authorization_context",
    );
    const activeOrganization = context?.organization;
    const membership = context?.membership;
    if (
      contextError || !activeOrganization?.id || membership?.user_id !== user.id
    ) {
      throw new OrbRequestError(
        "ACTIVE_ORGANIZATION_REQUIRED",
        403,
        "Active organization is required.",
      );
    }
    const openAIKey = readOpenAIKey();

    const { data: turnRows, error: turnError } = await userClient.rpc(
      "begin_orb_turn",
      {
        target_conversation_id: payload.conversation_id,
        target_client_message_id: payload.client_message_id,
        target_content: payload.message,
        target_provider: config.provider,
        target_model: config.model,
      },
    );
    if (turnError || !turnRows?.length) {
      const code = turnError?.code === "P0002"
        ? "CONVERSATION_NOT_FOUND"
        : "TURN_NOT_ACCEPTED";
      throw new OrbRequestError(
        code,
        code === "CONVERSATION_NOT_FOUND" ? 404 : 409,
        "Conversation is unavailable.",
      );
    }
    const turn = turnRows[0] as TurnRecord;
    assistantMessageId = turn.assistant_message_id;

    if (turn.assistant_status === "completed") {
      return new Response(
        orbEvent("start", {
          conversation_id: turn.conversation_id,
          assistant_message_id: assistantMessageId,
          replay: true,
        }) +
          orbEvent("delta", { delta: turn.assistant_content }) +
          orbEvent("completed", {
            assistant_message_id: assistantMessageId,
            replay: true,
          }),
        { status: 200, headers: streamHeaders },
      );
    }
    if (turn.assistant_status === "failed") {
      throw new OrbRequestError(
        "PREVIOUS_ATTEMPT_FAILED",
        409,
        "This request previously failed. Send it again as a new message.",
      );
    }

    adminClient = createClient(supabaseUrl, serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    processingToken = crypto.randomUUID();
    const { data: claimed, error: claimError } = await adminClient.rpc(
      "claim_orb_assistant_message",
      {
        target_assistant_message_id: assistantMessageId,
        target_processing_token: processingToken,
      },
    );
    if (claimError) {
      throw new OrbRequestError(
        "TURN_CLAIM_FAILED",
        500,
        "Orb could not claim the request.",
      );
    }
    if (!claimed) {
      throw new OrbRequestError(
        "REQUEST_IN_PROGRESS",
        409,
        "This request is already in progress.",
      );
    }

    const { data: historyRows, error: historyError } = await userClient
      .from("orb_messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", turn.conversation_id)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(24);
    if (historyError) {
      throw new OrbRequestError(
        "HISTORY_UNAVAILABLE",
        500,
        "Conversation history is unavailable.",
      );
    }
    const history = buildLimitedHistory(historyRows || []);

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (
          type: "start" | "delta" | "completed" | "error",
          data: Record<string, unknown>,
        ) => {
          controller.enqueue(encoder.encode(orbEvent(type, data)));
        };

        void (async () => {
          let output = "";
          let providerResponseId = "";
          const abortController = new AbortController();
          const timeout = setTimeout(
            () => abortController.abort(),
            config.timeoutMs,
          );
          try {
            send("start", {
              conversation_id: turn.conversation_id,
              assistant_message_id: assistantMessageId,
              instructions_version: ORB_INSTRUCTIONS_VERSION,
            });
            const response = await fetch(
              "https://api.openai.com/v1/responses",
              {
                method: "POST",
                headers: {
                  authorization: `Bearer ${openAIKey}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  model: config.model,
                  instructions: `${ORB_INSTRUCTIONS}\nContexto autorizado: ${
                    JSON.stringify({
                      organization_name: String(activeOrganization.name || "")
                        .slice(0, 120),
                      role: String(turn.membership_role || "member"),
                    })
                  }`,
                  input: history,
                  max_output_tokens: config.maxOutputTokens,
                  stream: true,
                  store: false,
                  safety_identifier: await privacyPreservingUserId(user.id),
                }),
                signal: abortController.signal,
              },
            );
            await consumeOpenAIStream(
              response,
              (delta) => {
                if (output.length + delta.length > 16_000) {
                  throw new OrbRequestError(
                    "OUTPUT_TOO_LARGE",
                    502,
                    "Orb response exceeded the allowed size.",
                  );
                }
                output += delta;
                send("delta", { delta });
              },
              (responseId) => {
                providerResponseId = responseId;
              },
            );
            if (!output.trim()) {
              throw new OrbRequestError(
                "EMPTY_AI_RESPONSE",
                502,
                "Orb returned an empty response.",
              );
            }

            const { data: completed, error: completionError } =
              await adminClient!.rpc("complete_orb_assistant_message", {
                target_assistant_message_id: assistantMessageId,
                target_processing_token: processingToken,
                target_content: output,
                target_provider_response_id: providerResponseId,
              });
            if (completionError || !completed) {
              throw new OrbRequestError(
                "PERSISTENCE_FAILED",
                500,
                "Orb could not persist the response.",
              );
            }
            send("completed", { assistant_message_id: assistantMessageId });
          } catch (error) {
            const failureCode =
              error instanceof DOMException && error.name === "AbortError"
                ? "AI_TIMEOUT"
                : sanitizeErrorCode(
                  error instanceof OrbRequestError ? error.code : undefined,
                );
            await adminClient!.rpc("fail_orb_assistant_message", {
              target_assistant_message_id: assistantMessageId,
              target_processing_token: processingToken,
              target_error_code: failureCode,
            });
            console.error("Orb request failed", {
              code: failureCode,
              conversationId: turn.conversation_id,
              assistantMessageId,
            });
            send("error", {
              code: failureCode,
              message: "Orb could not complete the response.",
            });
          } finally {
            clearTimeout(timeout);
            controller.close();
          }
        })();
      },
    });
    return new Response(stream, { status: 200, headers: streamHeaders });
  } catch (error) {
    const safe = publicError(error);
    if (assistantMessageId && adminClient) {
      await adminClient.rpc("fail_orb_assistant_message", {
        target_assistant_message_id: assistantMessageId,
        target_processing_token: processingToken,
        target_error_code: safe.code,
      });
    }
    console.error("Orb request rejected", {
      code: safe.code,
      status: safe.status,
      assistantMessageId,
    });
    return json(safe.status, { error: safe.code, message: safe.message });
  }
}

if (import.meta.main) Deno.serve(handleOrbChat);
