import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, ArrowDown, LoaderCircle, Menu, MessageSquareText, Plus, RotateCcw, Send, Sparkles, X } from "lucide-react";

import { useAuth } from "../Context/AuthContext";
import OrbMarkdown from "../features/orb/OrbMarkdown";
import { normalizeOrbMessages } from "../features/orb/orbMessageOrder";
import { deriveOrbSurfaceFromSearch } from "../features/orb/orbSurfaceContext";
import {
  appendAssistantDelta,
  failAssistantStream,
  finishAssistantStream,
  nextFollowState,
  reactivateFollow,
  reconcileAssistantStart,
  shouldFollowStreamGrowth,
} from "../features/orb/orbStream";
import { createOrbConversation, friendlyError, listOrbConversations, listOrbMessages, streamOrbMessage } from "../services/OrbService";
import "./Orb.css";

const ACTIVE_CONVERSATION_KEY = "orvesen-orb-active-conversation";
const suggestions = [
  "Ayúdame a ordenar una decisión compleja.",
  "Convierte una idea en próximos pasos claros.",
  "Hazme preguntas para entender mejor un problema.",
];

const OrbMessage = memo(function OrbMessage({ message, sending, onRetry }) {
  return <article id={`orb-message-${message.id}`} className={`orb-message orb-message-${message.role}`}>
    <div className="orb-message-label">{message.role === "assistant" ? "Orb" : "Tú"}</div>
    <div className="orb-message-content">{message.content ? (message.role === "assistant" ? <OrbMarkdown>{message.content}</OrbMarkdown> : message.content) : message.displayStatus === "streaming" ? <span className="orb-thinking"><span>Orb está pensando</span><i /><i /><i /></span> : null}</div>
    {message.displayStatus === "failed" ? <div className="orb-message-error"><span>La respuesta no pudo completarse.</span><button onClick={() => onRetry(message)} disabled={sending}><RotateCcw size={13} /> Reintentar</button></div> : null}
  </article>;
});

export default function Orb() {
  const [searchParams] = useSearchParams();
  const { session } = useAuth();
  const surface = useMemo(() => deriveOrbSurfaceFromSearch(searchParams), [searchParams]);
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(() => localStorage.getItem(ACTIVE_CONVERSATION_KEY));
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const requestController = useRef(null);
  const skipNextMessageLoad = useRef(false);
  const followLatest = useRef(true);
  const initialScroll = useRef(false);
  const previousScrollTop = useRef(0);
  const followTimer = useRef(null);
  const deltaTimer = useRef(null);
  const pendingDeltas = useRef(new Map());
  const retryHandler = useRef(null);

  const scrollToLatest = useCallback((behavior = "smooth") => {
    followLatest.current = reactivateFollow();
    setShowLatest(false);
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    previousScrollTop.current = node.scrollTop;
  }, []);

  const stopScheduledFollow = useCallback(() => {
    if (followTimer.current) window.clearTimeout(followTimer.current);
    followTimer.current = null;
  }, []);

  const scheduleFollowLatest = useCallback(() => {
    if (!shouldFollowStreamGrowth(followLatest.current) || followTimer.current) return;
    followTimer.current = window.setTimeout(() => {
      followTimer.current = null;
      if (!followLatest.current) return;
      const node = scrollRef.current;
      if (!node) return;
      node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
      previousScrollTop.current = node.scrollTop;
    }, 80);
  }, []);

  const flushPendingDeltas = useCallback(() => {
    if (deltaTimer.current) window.clearTimeout(deltaTimer.current);
    deltaTimer.current = null;
    const entries = [...pendingDeltas.current.entries()];
    pendingDeltas.current.clear();
    if (!entries.length) return;
    setMessages((current) => entries.reduce(
      (next, [assistantId, delta]) => appendAssistantDelta(next, assistantId, delta),
      current,
    ));
    scheduleFollowLatest();
  }, [scheduleFollowLatest]);

  const queueAssistantDelta = useCallback((assistantId, delta) => {
    if (!delta) return;
    pendingDeltas.current.set(
      assistantId,
      `${pendingDeltas.current.get(assistantId) || ""}${delta}`,
    );
    if (!deltaTimer.current) {
      deltaTimer.current = window.setTimeout(flushPendingDeltas, 40);
    }
  }, [flushPendingDeltas]);

  const discardPendingDeltas = useCallback(() => {
    if (deltaTimer.current) window.clearTimeout(deltaTimer.current);
    deltaTimer.current = null;
    pendingDeltas.current.clear();
  }, []);

  const handleRetry = useCallback((message) => {
    retryHandler.current?.(message);
  }, []);

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
    listOrbConversations().then((rows) => {
      if (!active) return;
      setConversations(rows);
      setActiveConversationId((current) => current && !rows.some((item) => item.id === current) ? null : current);
    }).catch((requestError) => active && setError(requestError.message)).finally(() => active && setLoading(false));
    return () => { active = false; requestController.current?.abort(); };
  }, []);

  useEffect(() => () => {
    stopScheduledFollow();
    discardPendingDeltas();
  }, [discardPendingDeltas, stopScheduledFollow]);

  useEffect(() => {
    if (!activeConversationId) return undefined;
    if (skipNextMessageLoad.current) { skipNextMessageLoad.current = false; return undefined; }
    let active = true;
    initialScroll.current = true;
    setLoadingMessages(true); setError("");
    localStorage.setItem(ACTIVE_CONVERSATION_KEY, activeConversationId);
    listOrbMessages(activeConversationId).then((rows) => active && setMessages(normalizeOrbMessages(rows)))
      .catch((requestError) => active && setError(requestError.message)).finally(() => active && setLoadingMessages(false));
    return () => { active = false; };
  }, [activeConversationId]);

  useLayoutEffect(() => {
    if (loadingMessages || !initialScroll.current) return;
    initialScroll.current = false;
    scrollToLatest("auto");
  }, [loadingMessages, messages, scrollToLatest]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [draft]);

  function handleScroll() {
    const node = scrollRef.current;
    if (!node) return;
    const next = nextFollowState({
      isFollowing: followLatest.current,
      previousScrollTop: previousScrollTop.current,
      currentScrollTop: node.scrollTop,
    });
    if (!next && followLatest.current) stopScheduledFollow();
    followLatest.current = next;
    previousScrollTop.current = node.scrollTop;
    setShowLatest(!next && messages.length > 0);
  }

  function startNewConversation() {
    if (sending) return;
    followLatest.current = true;
    setActiveConversationId(null); localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
    setMessages([]); setDraft(""); setError(""); setShowLatest(false); setHistoryOpen(false);
  }

  function selectConversation(id) {
    if (sending) return;
    followLatest.current = true;
    setActiveConversationId(id); setHistoryOpen(false); setShowLatest(false);
  }

  async function sendMessage(rawMessage = draft, retry = null) {
    const content = rawMessage.trim();
    if (!content || sending || !session) return;
    setSending(true); setError(""); setDraft(""); followLatest.current = true; setShowLatest(false);
    const clientMessageId = retry?.client_message_id || crypto.randomUUID();
    const optimisticUserId = `local-user-${clientMessageId}`;
    const optimisticAssistantId = `local-assistant-${clientMessageId}`;
    let streamedAssistantId = retry?.assistantId || optimisticAssistantId;
    let conversationId = activeConversationId;

    if (retry) {
      setMessages((current) => current.map((item) => item.id === retry.assistantId ? { ...item, content: "", error_code: null, displayStatus: "streaming" } : item));
    } else {
      const createdAt = new Date().toISOString();
      setMessages((current) => [...current,
        { id: optimisticUserId, client_message_id: clientMessageId, role: "user", content, created_at: createdAt, displayStatus: "completed" },
        { id: optimisticAssistantId, reply_to_message_id: optimisticUserId, role: "assistant", content: "", created_at: createdAt, displayStatus: "streaming" },
      ]);
      requestAnimationFrame(() => {
        document.getElementById(`orb-message-${optimisticUserId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    try {
      if (!conversationId) {
        const conversation = await createOrbConversation(content);
        conversationId = conversation.id;
        setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
        skipNextMessageLoad.current = true; setActiveConversationId(conversation.id);
        localStorage.setItem(ACTIVE_CONVERSATION_KEY, conversation.id);
      }
      const controller = new AbortController(); requestController.current = controller;
      await streamOrbMessage({ conversationId, clientMessageId, message: content, surface, signal: controller.signal, onEvent(type, payload) {
        if (type === "start" && payload.assistant_message_id) {
          streamedAssistantId = payload.assistant_message_id;
          setMessages((current) => reconcileAssistantStart(current, optimisticAssistantId, streamedAssistantId));
        }
        if (type === "delta") queueAssistantDelta(streamedAssistantId, payload.delta || "");
        if (type === "completed") {
          flushPendingDeltas();
          setMessages((current) => finishAssistantStream(current, streamedAssistantId));
        }
        if (type === "error") {
          discardPendingDeltas();
          setMessages((current) => failAssistantStream(current, streamedAssistantId, payload.code));
          const streamError = new Error(friendlyError(payload.code)); streamError.code = payload.code; throw streamError;
        }
      } });
      flushPendingDeltas();
      setMessages(normalizeOrbMessages(await listOrbMessages(conversationId)));
      await loadConversations();
    } catch (requestError) {
      discardPendingDeltas();
      if (requestError.name !== "AbortError") {
        setMessages((current) => failAssistantStream(current, streamedAssistantId, requestError.code));
        setError(requestError.message || "Orb no pudo responder.");
      }
      if (conversationId) listOrbMessages(conversationId).then((rows) => setMessages(normalizeOrbMessages(rows))).catch(() => {});
    } finally { requestController.current = null; setSending(false); }
  }

  function retryAssistant(message) {
    const userMessage = messages.find((item) => item.id === message.reply_to_message_id);
    if (!userMessage?.client_message_id) { setError("Este turno no puede reintentarse de forma segura."); return; }
    void sendMessage(userMessage.content, { assistantId: message.id, client_message_id: userMessage.client_message_id });
  }

  useEffect(() => {
    retryHandler.current = retryAssistant;
  });

  function handleSubmit(event) { event.preventDefault(); void sendMessage(); }
  function handleKeyDown(event) { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }
  const hasConversation = Boolean(activeConversationId || messages.length);

  return <div className="orb-page">
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
        <div className="orb-suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}</div>
      </div> : <div className="orb-message-scroll" ref={scrollRef} onScroll={handleScroll}><div className="orb-message-column">
        {loadingMessages ? <div className="orb-centered-state"><LoaderCircle className="orb-spin" size={22} /> Cargando conversación</div> : null}
        {!loadingMessages && messages.map((message) => <OrbMessage key={message.id} message={message} sending={sending} onRetry={handleRetry} />)}
      </div></div>}
      {showLatest ? <button className="orb-jump-latest" onClick={() => scrollToLatest()}><ArrowDown size={15} /> Ir al mensaje más reciente</button> : null}

      <div className="orb-composer-shell">
        {error ? <div className="orb-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div> : null}
        <form className="orb-composer" onSubmit={handleSubmit}><textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder="Escribe tu mensaje…" rows={1} maxLength={8000} disabled={sending} aria-label="Mensaje para Orb" /><button type="submit" disabled={sending || !draft.trim()} aria-label="Enviar mensaje">{sending ? <LoaderCircle className="orb-spin" size={19} /> : <Send size={19} />}</button></form>
        <p className="orb-disclaimer"><Sparkles size={12} /> Orb puede equivocarse. Verifica las decisiones importantes.</p>
      </div>
    </section>
  </div>;
}
