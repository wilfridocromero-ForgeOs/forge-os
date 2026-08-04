import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import AuthBackground from "../components/display/AuthBackground";
import Logo from "../components/display/Logo";
import { supabase } from "../lib/supabase";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session)));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setReady(Boolean(session));
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (password !== confirmPassword) return setError("Las contraseñas no coinciden.");
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setLoading(false);
      return setError(updateError.message);
    }
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden overflow-y-auto bg-[#09090B] px-4 py-6">
      <AuthBackground />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3rem)] max-w-lg items-center">
        <div className="w-full rounded-3xl border border-zinc-800 bg-[#111113]/90 p-7 shadow-2xl sm:p-10">
          <Logo />
          <h1 className="mt-8 text-center text-2xl font-semibold text-white">Crea tu contraseña</h1>
          <p className="mt-3 text-center text-sm leading-6 text-zinc-500">Completa tu invitación para entrar al espacio de trabajo que te asignaron.</p>
          {!ready ? (
            <p className="mt-8 rounded-xl border border-zinc-800 bg-black/30 p-4 text-center text-sm text-zinc-400">Abre esta página desde el enlace recibido por correo. Si el enlace venció, solicita una invitación nueva.</p>
          ) : (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <label className="block"><span className="mb-2 block text-sm text-zinc-400">Nueva contraseña</span><input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white" /></label>
              <label className="block"><span className="mb-2 block text-sm text-zinc-400">Repetir contraseña</span><input required type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full rounded-xl border border-zinc-700 bg-black px-4 py-3 text-white" /></label>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button disabled={loading} className="w-full rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-60">{loading ? "Guardando..." : "Crear contraseña"}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
