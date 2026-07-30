import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e) {
    e.preventDefault();

    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    navigate("/");
  }

  return (
    <div className="min-h-screen bg-[#09090B] flex items-center justify-center px-6">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-[#111113] p-8">

        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-wide text-white">
            ORVESEN
          </h1>

          <p className="mt-2 text-sm text-zinc-400">
            Inicia sesión para continuar.
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">

          <div>
            <label className="mb-2 block text-sm text-zinc-400">
              Correo electrónico
            </label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none focus:border-white"
              placeholder="correo@orvesen.com"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-zinc-400">
              Contraseña
            </label>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-white outline-none focus:border-white"
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-white py-3 font-medium text-black transition hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Ingresando..." : "Continuar"}
          </button>

        </form>

      </div>
    </div>
  );
}