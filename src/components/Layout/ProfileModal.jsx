import { useState } from "react";

import { useAuth } from "../../Context/AuthContext";

export default function ProfileModal({ onClose }) {
  const { displayName, displayTitle, updateProfile } = useAuth();
  const [firstName, setFirstName] = useState(displayName);
  const [title, setTitle] = useState(displayTitle);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await updateProfile({ firstName, title });
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

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-[#111113] p-7 shadow-2xl">
        <h2 className="text-2xl font-semibold text-white">Editar perfil</h2>
        <p className="mt-2 text-sm text-zinc-500">
          Personaliza el nombre y el título que aparecen en ORVESEN.
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

          <label className="block">
            <span className="mb-2 block text-sm text-zinc-400">Título o función</span>
            <input
              maxLength={80}
              placeholder="Ej. Fundador, Director, Colaborador"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-white outline-none focus:border-zinc-600"
            />
          </label>

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
    </div>
  );
}
