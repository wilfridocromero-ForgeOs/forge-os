import { useState } from "react";
import { createPortal } from "react-dom";

import { useAuth } from "../../Context/AuthContext";

export default function ProfileModal({ onClose }) {
  const { displayName, displayTitle, updateProfile } = useAuth();
  const [firstName, setFirstName] = useState(displayName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await updateProfile({ firstName });
      onClose();
    } catch (profileError) {
      setError(
        profileError instanceof Error
          ? profileError.message
          : "No se pudo actualizar el perfil.",
      );
    } finally {
      setLoading(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/70 px-3 py-6 sm:px-4 sm:py-8">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-[#111113] p-6 shadow-2xl sm:p-7">
        <h2 className="text-2xl font-semibold text-white">Editar perfil</h2>
        <p className="mt-2 text-sm text-zinc-500">
          Puedes cambiar tu nombre visible. Tu rol y permisos los administra ORVESEN.
        </p>

        <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">Nombre visible</span>
            <input
              required
              maxLength={80}
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none focus:border-zinc-600"
            />
          </label>

          <div className="rounded-xl border border-zinc-800 bg-black/40 px-4 py-3">
            <span className="block text-xs uppercase tracking-[0.18em] text-zinc-500">Rol asignado</span>
            <span className="mt-1 block text-white">{displayTitle}</span>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-5 py-3 text-zinc-400 hover:text-white"
            >
              Cancelar
            </button>
            <button
              disabled={loading}
              type="submit"
              className="rounded-xl bg-white px-5 py-3 font-medium text-black disabled:opacity-60"
            >
              {loading ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
