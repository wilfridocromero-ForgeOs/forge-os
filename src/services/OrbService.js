import { supabase } from "../lib/supabase";
import { consumeOrbEventReader } from "../features/orb/orbStream";
import { buildOrbRequestPayload } from "../features/orb/orbSurfaceContext";

const ORB_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/orb-chat`;

function friendlyError(code) {
  const messages = {
    AI_NOT_CONFIGURED: "Orb todavía no está configurado para responder.",
    AI_BILLING_INACTIVE: "La facturación de Orb no está activa. Contacta al administrador.",
    AI_QUOTA_EXCEEDED: "Orb no tiene crédito de API disponible. Contacta al administrador.",
    AI_RATE_LIMITED: "Orb está recibiendo muchas solicitudes. Inténtalo nuevamente en un momento.",
    AI_TIMEOUT: "Orb tardó más de lo esperado. Puedes volver a intentarlo.",
    CONVERSATION_NOT_FOUND: "Esta conversación ya no está disponible.",
    INVALID_SESSION: "Tu sesión venció. Vuelve a iniciar sesión.",
    REQUEST_IN_PROGRESS: "Orb ya está procesando este mensaje.",
  };
  return messages[code] || "Orb no pudo completar la respuesta. Inténtalo nuevamente.";
}

export async function listOrbConversations() {
  const { data, error } = await supabase.from("orb_conversations")
    .select("id, title, status, created_at, updated_at, last_message_at")
    .eq("status", "active")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createOrbConversation(title) {
  const { data, error } = await supabase.rpc("create_orb_conversation", {
    target_title: title.trim().slice(0, 120) || "Nueva conversación",
  });
  if (error) throw error;
  return data;
}

export async function listOrbMessages(conversationId) {
  const { data, error } = await supabase.from("orb_messages")
    .select("id, conversation_id, role, content, status, error_code, client_message_id, reply_to_message_id, created_at, completed_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listOrbActionProposals(conversationId) {
  const { data, error } = await supabase.from("orb_action_proposals")
    .select("id, action_type, conversation_id, user_message_id, arguments_hash, display_payload, status, expires_at, result_entity_id, safe_error_code, created_at, updated_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function confirmOrbActionProposal(proposalId, argumentsHash) {
  const { data, error } = await supabase.rpc("confirm_orb_action_proposal", {
    target_proposal_id: proposalId,
    expected_arguments_hash: argumentsHash,
  });
  if (error) throw error;
  return data;
}

export async function cancelOrbActionProposal(proposalId) {
  const { data, error } = await supabase.rpc("cancel_orb_action_proposal", {
    target_proposal_id: proposalId,
  });
  if (error) throw error;
  return data;
}

export async function streamOrbMessage({ conversationId, clientMessageId, message, surface = null, onEvent, signal }) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) throw new Error("Tu sesión ya no está disponible.");

  const response = await fetch(ORB_FUNCTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildOrbRequestPayload({ conversationId, clientMessageId, message, surface, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null })),
    signal,
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(friendlyError(payload.error));
    error.code = payload.error || "ORB_REQUEST_FAILED";
    throw error;
  }

  const terminal = await consumeOrbEventReader(response.body.getReader(), onEvent);
  if (terminal.error) {
    const error = new Error(friendlyError(terminal.error.code));
    error.code = terminal.error.code || "ORB_REQUEST_FAILED";
    throw error;
  }
}

export { friendlyError };
