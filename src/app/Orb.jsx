import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, LoaderCircle, Menu, MessageSquareText, Plus, Send, Sparkles, X } from "lucide-react";

import { useAuth } from "../Context/AuthContext";
import { createOrbConversation, friendlyError, listOrbConversations, listOrbMessages, streamOrbMessage } from "../services/OrbService";
import "./Orb.css";

const ACTIVE_CONVERSATION_KEY = "orvesen-orb-active-conversation";
const suggestions = [
  "Ayúdame a ordenar una decisión compleja.",
  "Convierte una idea en próximos pasos claros.",
  "Hazme preguntas para entender mejor un problema.",
];
const normalizeMessages = (rows) => rows.map((message) => ({ ...message, displayStatus: message.status }));

export default function Orb() {
  const { session } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(() => localStorage.getItem(ACTIVE_CONVERSATION_KEY));
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [retryMessage, setRetryMessage] = useState("");
  const endRef = useRef(null);
  const requestController = useRef(null);
  const skipNextMessageLoad = useRef(false);

  const loadConversations = useCallback(async () => {
    const rows = await listOrbConversations();
    setConversations(rows);
    setActiveConversationId((current) => {
      if (!current || rows.some((conversation) => conversation.id === current)) return current;
      localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      return null;
    });
    return rows;
  }, []);

  useEffect(() => {
    let active = true;
    async function initializeConversations() {
      try {
        const rows = await listOrbConversations();
        if (!active) return;
        setConversations(rows);
        setActiveConversationId((current) => {
          if (!current || rows.some((conversation) => conversation.id === current)) return current;
          localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
          return null;
        });
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }
    void initializeConversations();
    return () => { active = false; requestController.current?.abort(); };
  }, [loadConversations]);

  useEffect(() => {
    if (!activeConversationId) return undefined;
    if (skipNextMessageLoad.current) {
      skipNextMessageLoad.current = false;
      return undefined;
    }
    let active = true;
    setLoadingMessages(true);
    setError("");
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId);
    listOrbMessages(activeConversationId).then((rows) => active && setMessages(normalizeMessages(rows)))
      .catch((requestError) => active && setError(requestError.message)).finally(() => active && setLoadingMessages(false));
    return () => { active = false; };
  }, [activeConversationId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: sending ? "smooth" : "auto", block: "end" }); }, [messages, sending]);

  function startNewConversation() {
    if (sending) return;
    setActiveConversationId(null); localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    setMessages([]); setDraft(""); setError(""); setRetryMessage(""); setHistoryOpen(false);
  }

  function selectConversation(id) {
    if (sending) return;
    setActiveConversationId(id); setHistoryOpen(false); setRetryMessage("");
  }

  async function sendMessage(rawMessage = draft) {
    const content = rawMessage.trim();
    if (!content || sending || !session) return;
    setSending(true); setError(""); setRetryMessage(""); setDraft("");
    const clientMessageId = crypto.randomUUID();
    const optimisticUserId = `local-user-${clientMessageId}`;
    const optimisticAssistantId = `local-assistant-${clientMessageId}`;
    let streamedAssistantId = optimisticAssistantId;
    let conversationId = activeConversationId;

    try {
      if (!conversationId) {
        const conversation = await createOrbConversation(content);
        conversationId = conversation.id;
        setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
        skipNextMessageLoad.current = true;
        setActiveConversationId(conversation.id);
        localStorage.setItem(ACTIVE_CONVERSATION_KEY, conversation.id);
      }
      setMessages((current) => [...current,
        { id: optimisticUserId, role: "user", content, displayStatus: "completed" },
        { id: optimisticAssistantId, role: "assistant", content: "", displayStatus: "streaming" },
      ]);

      const controller = new AbortController();
      requestController.current = controller;
      await streamOrbMessage({ conversationId, clientMessageId, message: content, signal: controller.signal, onEvent(type, payload) {
        if (type === "start" && payload.assistant_message_id) {
          streamedAssistantId = payload.assistant_message_id;
          setMessages((current) => current.map((item) => item.id === optimisticAssistantId ? { ...item, id: streamedAssistantId } : item));
        }
        if (type === "delta") setMessages((current) => current.map((item) => item.id === streamedAssistantId ? { ...item, content: item.content + (payload.delta || "") } : item));
        if (type === "completed") setMessages((current) => current.map((item) => item.id === streamedAssistantId ? { ...item, displayStatus: "completed" } : item));
        if (type === "error") { const streamError = new Error(friendlyError(payload.code)); streamError.code = payload.code; throw streamError; }
      } });
      setMessages(normalizeMessages(await listOrbMessages(conversationId)));
      await loadConversations();
    } catch (requestError) {
      if (requestError.name !== "AbortError") { setError(requestError.message || "Orb no pudo responder."); setRetryMessage(content); }
      if (conversationId) listOrbMessages(conversationId).then((rows) => setMessages(normalizeMessages(rows))).catch(() => {});
    } finally { requestController.current = null; setSending(false); }
  }

  function handleSubmit(event) { event.preventDefault(); void sendMessage(); }
  function handleKeyDown(event) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }
  const hasConversation = Boolean(activeConversationId || messages.length);

  return (
    <div className="orb-page">
      <button className="orb-history-toggle" onClick={() => setHistoryOpen(true)} aria-label="Abrir conversaciones"><Menu size={19} /><span>Conversaciones</span></button>
      {historyOpen && <button className="orb-history-backdrop" aria-label="Cerrar conversaciones" onClick={() => setHistoryOpen(false)} />}
      <aside className={`orb-history ${historyOpen ? "is-open" : ""}`}>
        <div className="orb-history-header"><div><p className="orb-eyebrow">ORVESEN IA</p><h2>Conversaciones</h2></div><button className="orb-mobile-close" onClick={() => setHistoryOpen(false)} aria-label="Cerrar conversaciones"><X size={19} /></button></div>
        <button className="orb-new-chat" onClick={startNewConversation} disabled={sending}><Plus size={18} /> Nueva conversación</button>
        <div className="orb-conversation-list">
          {loading ? <div className="orb-history-loading"><LoaderCircle className="orb-spin" size={18} /> Cargando</div> : null}
          {!loading && conversations.length === 0 ? <p className="orb-history-empty">Tus conversaciones aparecerán aquí.</p> : null}
          {conversations.map((conversation) => <button key={conversation.id} className={`orb-conversation-item ${conversation.id === activeConversationId ? "is-active" : ""}`} onClick={() => selectConversation(conversation.id)} disabled={sending}><MessageSquareText size={16} /><span>{conversation.title || "Nueva conversación"}</span></button>)}
        </div>
      </aside>

      <section className={`orb-chat ${hasConversation ? "has-conversation" : "is-empty"}`}>
        {!hasConversation ? <div className="orb-welcome">
          <div className="orb-mark"><img src="/orvesen-mark.png" alt="" /></div><p className="orb-eyebrow">ORVESEN IA</p><h1>Orb</h1><h2>¿En qué trabajamos hoy?</h2><p className="orb-welcome-copy">Tu inteligencia para pensar, decidir y operar mejor.</p>
          <div className="orb-suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => setDraft(suggestion)}>{suggestion}</button>)}</div>
        </div> : <div className="orb-message-scroll"><div className="orb-message-column">
          {loadingMessages ? <div className="orb-centered-state"><LoaderCircle className="orb-spin" size={22} /> Cargando conversación</div> : null}
          {!loadingMessages && messages.map((message) => <article key={message.id} className={`orb-message orb-message-${message.role}`}><div className="orb-message-label">{message.role === "assistant" ? "Orb" : "Tú"}</div><div className="orb-message-content">{message.content || (message.displayStatus === "streaming" ? <span className="orb-thinking"><i /><i /><i /></span> : "")}</div>{message.displayStatus === "failed" ? <p className="orb-message-error">La respuesta no pudo completarse.</p> : null}</article>)}
          <div ref={endRef} />
        </div></div>}

        <div className="orb-composer-shell">
          {error ? <div className="orb-error" role="alert"><AlertCircle size={17} /><span>{error}</span>{retryMessage && !sending ? <button onClick={() => void sendMessage(retryMessage)}>Reintentar</button> : null}</div> : null}
          <form className="orb-composer" onSubmit={handleSubmit}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder="Pregúntale a Orb…" rows={1} maxLength={8000} disabled={sending} aria-label="Mensaje para Orb" /><button type="submit" disabled={sending || !draft.trim()} aria-label="Enviar mensaje">{sending ? <LoaderCircle className="orb-spin" size={19} /> : <Send size={19} />}</button></form>
          <p className="orb-disclaimer"><Sparkles size={12} /> Orb puede equivocarse. Verifica las decisiones importantes.</p>
        </div>
      </section>
    </div>
  );
}
