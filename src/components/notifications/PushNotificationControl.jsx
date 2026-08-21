import { BellOff, BellRing, CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { disableDevicePush, enableDevicePush, getDevicePushState } from "../../services/PushSubscriptionService";

export default function PushNotificationControl({ userId, organizationId }) {
  const [state, setState] = useState({ loading: true, supported: true, configured: true, permission: "default", active: false });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getDevicePushState()
      .then((nextState) => { if (active) setState({ ...nextState, loading: false }); })
      .catch(() => {
        if (!active) return;
        setState((current) => ({ ...current, loading: false, active: false }));
        setError("No pudimos comprobar Web Push. Las notificaciones dentro de ORVESEN siguen disponibles.");
      });
    return () => { active = false; };
  }, []);

  async function enable() {
    setWorking(true);
    setError("");
    try {
      setState({ ...(await enableDevicePush(userId, organizationId)), loading: false });
    } catch (requestError) {
      setError(requestError.message || "No pudimos activar las notificaciones en este dispositivo.");
      try {
        setState({ ...(await getDevicePushState()), loading: false });
      } catch {
        setState((current) => ({ ...current, loading: false, active: false }));
      }
    } finally {
      setWorking(false);
    }
  }

  async function disable() {
    setWorking(true);
    setError("");
    try {
      setState({ ...(await disableDevicePush(userId, organizationId)), loading: false });
    } catch (requestError) {
      setError(requestError.message || "No pudimos desactivar las notificaciones en este dispositivo.");
    } finally {
      setWorking(false);
    }
  }

  if (state.loading) return <div className="push-control is-loading"><LoaderCircle className="push-spinner" size={17} /><span>Comprobando notificaciones del dispositivo…</span></div>;

  if (!state.supported) return <div className="push-control"><BellOff size={18} /><div><strong>No disponible en este navegador</strong><span>En iPhone o iPad, añade ORVESEN a la pantalla de inicio para activar Web Push.</span></div></div>;

  if (!state.configured) return <div className="push-control"><CircleAlert size={18} /><div><strong>Configuración pendiente</strong><span>La clave pública de Web Push aún no está disponible en este entorno.</span></div></div>;

  if (state.permission === "denied") return <div className="push-control"><BellOff size={18} /><div><strong>Notificaciones bloqueadas</strong><span>Puedes habilitarlas desde la configuración del navegador o del dispositivo.</span></div></div>;

  if (error && !state.active) return <div className="push-control"><CircleAlert size={18} /><div><strong>No pudimos comprobar Web Push</strong><span className="push-control-error">{error}</span></div><button type="button" disabled={working} onClick={enable}>Intentar de nuevo</button></div>;

  return <div className={`push-control ${state.active ? "is-active" : ""}`}>
    <BellRing size={18} />
    <div className="push-control-copy">
      <strong>{state.active ? "Notificaciones en este dispositivo: activadas" : "Recibe avisos importantes en este dispositivo"}</strong>
      <span>{state.active ? "Este dispositivo recibirá los avisos operativos de ORVESEN." : "La solicitud de permiso aparecerá únicamente después de tu confirmación."}</span>
      {error && <span className="push-control-error">{error}</span>}
    </div>
    <button type="button" disabled={working} onClick={state.active ? disable : enable} className={state.active ? "is-secondary" : ""}>
      {working ? "Procesando…" : state.active ? "Desactivar" : "Activar notificaciones"}
    </button>
  </div>;
}
