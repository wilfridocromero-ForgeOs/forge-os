import { Popover as HeadlessPopover } from "@headlessui/react";
import { Bell, BriefcaseBusiness, CheckCheck, CircleAlert, MessageSquareText, RefreshCw, X } from "lucide-react";
import { Component, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../Context/AuthContext";
import { getNotificationsPage, getUnreadNotificationCount, markAllNotificationsRead, markNotificationRead, NOTIFICATION_PAGE_SIZE } from "../../services/NotificationService";
import PushNotificationControl from "./PushNotificationControl";
import "./Notifications.css";

const iconByType = {
  task_assigned: BriefcaseBusiness,
  task_reassigned: RefreshCw,
  task_completed: CheckCheck,
  task_reopened: RefreshCw,
  project_comment_added: MessageSquareText,
};

function relativeTime(value) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days} d`;
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(value));
}

function isSafeInternalPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

function useMobileNotificationSheet() {
  const query = "(max-width: 639px)";
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia(query);
    const update = () => setMobile(media.matches);
    update();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return mobile;
}

class PushControlBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <div className="push-control"><CircleAlert size={18} /><div><strong>Web Push no está disponible ahora</strong><span>Las notificaciones dentro de ORVESEN siguen funcionando. Intenta nuevamente más tarde.</span></div></div>;
    }
    return this.props.children;
  }
}

export default function NotificationBell() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const organizationId = profile?.organization_id;
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const mobileSheet = useMobileNotificationSheet();

  useEffect(() => {
    let active = true;
    getUnreadNotificationCount(user?.id, organizationId)
      .then((count) => { if (active) setUnreadCount(count); })
      .catch(() => { if (active) setUnreadCount(0); });
    return () => { active = false; };
  }, [organizationId, user?.id]);

  async function loadInitial() {
    if (loading || loaded) return;
    setLoading(true);
    setError("");
    try {
      const rows = await getNotificationsPage(user?.id, organizationId);
      setNotifications(rows);
      setHasMore(rows.length === NOTIFICATION_PAGE_SIZE);
      setLoaded(true);
    } catch {
      setError("No pudimos cargar tus notificaciones.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    const cursor = notifications.at(-1);
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const rows = await getNotificationsPage(user?.id, organizationId, cursor);
      setNotifications((current) => [...current, ...rows]);
      setHasMore(rows.length === NOTIFICATION_PAGE_SIZE);
    } catch {
      setError("No pudimos cargar más notificaciones.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function readAll() {
    setError("");
    try {
      await markAllNotificationsRead(user?.id, organizationId);
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at || readAt })));
      setUnreadCount(0);
    } catch {
      setError("No pudimos marcar las notificaciones como leídas.");
    }
  }

  async function openNotification(notification, close) {
    setError("");
    try {
      if (!notification.read_at) {
        await markNotificationRead(notification.id);
        setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
        setUnreadCount((current) => Math.max(0, current - 1));
      }
      close();
      if (isSafeInternalPath(notification.action_url)) navigate(notification.action_url);
    } catch {
      setError("No pudimos abrir esta notificación.");
    }
  }

  const badge = unreadCount > 9 ? "9+" : String(unreadCount);

  return <HeadlessPopover as="div" className="notification-root">
    {({ open, close }) => <>
      <HeadlessPopover.Button onClick={() => { if (!open) loadInitial(); }} className="notification-bell" aria-label={unreadCount ? `Notificaciones, ${unreadCount} sin leer` : "Notificaciones"}>
        <Bell size={18} />
        {unreadCount > 0 && <span className="notification-badge" aria-hidden="true">{badge}</span>}
      </HeadlessPopover.Button>
      <HeadlessPopover.Panel portal={mobileSheet} className="notification-panel">
        <header className="notification-header">
          <div className="min-w-0"><p className="notification-eyebrow">Centro personal</p><h2>Notificaciones</h2><p>{unreadCount ? `${unreadCount} sin leer` : "Todo al día"}</p></div>
          <button type="button" onClick={close} className="notification-close" aria-label="Cerrar notificaciones"><X size={19} /></button>
        </header>
        <div className="notification-toolbar">
          <button type="button" onClick={readAll} disabled={!unreadCount}><CheckCheck size={16} /> Marcar todas como leídas</button>
        </div>
        <PushControlBoundary><PushNotificationControl userId={user?.id} organizationId={organizationId} /></PushControlBoundary>
        <div className="notification-list">
          {loading && <p className="notification-state">Cargando notificaciones…</p>}
          {!loading && error && <p className="notification-error"><CircleAlert size={16} /> {error}</p>}
          {!loading && loaded && !notifications.length && <div className="notification-empty"><Bell size={26} /><strong>No tienes notificaciones todavía.</strong><span>Cuando algo requiera tu atención aparecerá aquí.</span></div>}
          {!loading && notifications.map((notification) => <NotificationItem key={notification.id} notification={notification} onOpen={() => openNotification(notification, close)} />)}
          {hasMore && <button type="button" disabled={loadingMore} onClick={loadMore} className="notification-more">{loadingMore ? "Cargando…" : "Ver más"}</button>}
        </div>
      </HeadlessPopover.Panel>
    </>}
  </HeadlessPopover>;
}

function NotificationItem({ notification, onOpen }) {
  const Icon = iconByType[notification.type] || Bell;
  return <button type="button" onClick={onOpen} className={`notification-item ${notification.read_at ? "is-read" : "is-unread"}`}>
    <span className="notification-icon"><Icon size={17} /></span>
    <span className="notification-copy"><strong>{notification.title}</strong>{notification.body && <span>{notification.body}</span>}<time dateTime={notification.created_at}>{relativeTime(notification.created_at)}</time></span>
    {!notification.read_at && <span className="notification-unread-dot" aria-label="Sin leer" />}
  </button>;
}
