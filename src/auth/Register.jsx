import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { supabase } from "../lib/supabase";
import Logo from "../components/display/Logo";
import AuthBackground from "../components/display/AuthBackground";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function handleChange(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  async function handleRegister(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const name = form.name.trim();
      const { data, error: authError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            first_name: name,
            organization_name: `${name} - ORVESEN`,
          },
        },
      });

      if (authError) throw authError;

      if (data.session) {
        navigate("/", { replace: true });
        return;
      }

      setMessage(
        "Cuenta creada. Revisa tu correo y confirma el registro antes de iniciar sesión.",
      );
    } catch (registrationError) {
      setError(
        registrationError instanceof Error
          ? registrationError.message
          : "No se pudo crear la cuenta.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#09090B] px-6 py-8">
      <AuthBackground />
      <div className="relative z-10 w-full max-w-md rounded-3xl border border-zinc-800 bg-[#111113]/80 p-8 shadow-[0_30px_80px_rgba(0,0,0,.45)] backdrop-blur-xl">
        <Logo size="small" />
        <h1 className="mb-2 mt-8 text-center text-2xl font-semibold text-white">Crear cuenta</h1>
        <p className="mb-8 text-center text-zinc-400">Crea tu espacio ORVESEN.</p>

        {error && <div className="mb-4 text-sm text-red-400">{error}</div>}
        {message && (
          <div className="mb-4 rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-300">
            {message}
          </div>
        )}

        <form onSubmit={handleRegister} className="space-y-4">
          <input
            required
            name="name"
            placeholder="Nombre"
            value={form.name}
            onChange={handleChange}
            className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white"
          />
          <input
            required
            name="email"
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={handleChange}
            className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white"
          />
          <input
            required
            minLength={8}
            name="password"
            type="password"
            placeholder="Contraseña"
            value={form.password}
            onChange={handleChange}
            className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white"
          />
          <button
            disabled={loading || Boolean(message)}
            className="w-full rounded-xl bg-white py-3 font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
          >
            {loading ? "Creando..." : "Crear cuenta"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-400">
          ¿Ya tienes cuenta?{" "}
          <Link className="text-white hover:underline" to="/login">
            Inicia sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
