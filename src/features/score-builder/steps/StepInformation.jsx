import { ChevronRight } from "lucide-react";
import Button from "../../../components/ui/Button";

export default function StepInformation({
  form,
  setForm,
  onNext,
}) {
  function update(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  return (
    <div className="mx-auto w-full max-w-3xl">

      {/* Encabezado */}

      <div className="mb-10">

        <span className="text-sm uppercase tracking-[0.25em] text-zinc-500">
          Paso 1 de 6
        </span>

        <h1 className="mt-3 text-4xl font-bold text-white">
          Información de la evaluación
        </h1>

        <p className="mt-3 text-zinc-500">
          Define la información principal de esta evaluación.
          Más adelante podrás añadir categorías, preguntas y configurar
          el cálculo del score.
        </p>

      </div>

      <div className="rounded-3xl border border-zinc-800 bg-[#111113] p-8">

        <div className="mb-6">

          <label className="mb-2 block text-sm font-medium text-zinc-300">
            Nombre
          </label>

          <input
            type="text"
            value={form.name || ""}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Ej. ORVESEN Digital 360"
            className="w-full rounded-2xl border border-zinc-800 bg-[#09090B] px-5 py-4 text-white outline-none transition focus:border-zinc-600"
          />

        </div>

        <div className="mb-6">

          <label className="mb-2 block text-sm font-medium text-zinc-300">
            Descripción
          </label>

          <textarea
            rows={5}
            value={form.description || ""}
            onChange={(e) => update("description", e.target.value)}
            placeholder="Describe el propósito de esta evaluación..."
            className="w-full rounded-2xl border border-zinc-800 bg-[#09090B] px-5 py-4 text-white outline-none transition focus:border-zinc-600"
          />

        </div>

        <div className="mb-8">

          <label className="mb-2 block text-sm font-medium text-zinc-300">
            División
          </label>

          <select
            value={form.division || "ORVESEN Digital"}
            onChange={(e) => update("division", e.target.value)}
            className="w-full rounded-2xl border border-zinc-800 bg-[#09090B] px-5 py-4 text-white outline-none transition focus:border-zinc-600"
          >
            <option>ORVESEN Digital</option>
            <option>ORVESEN Studio</option>
            <option>ORVESEN Media</option>
            <option>ORVESEN Academy</option>
            <option>ORVESEN OS</option>
          </select>

        </div>

        <div className="mb-8">

          <label className="mb-3 block text-sm font-medium text-zinc-300">
            Escala del Score
          </label>

          <div className="flex gap-4">

            {[100, 500, 1000].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => update("scale", value)}
                                className={`flex-1 rounded-2xl border px-5 py-4 transition ${
                  form.scale === value
                    ? "border-white bg-white text-black"
                    : "border-zinc-800 bg-[#09090B] text-zinc-400 hover:border-zinc-600"
                }`}
              >
                {value}
              </button>
            ))}

          </div>

        </div>

        <div className="mb-10">

          <label className="mb-2 block text-sm font-medium text-zinc-300">
            Estado
          </label>

          <div className="inline-flex rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300">
            Borrador
          </div>

        </div>

        <div className="flex justify-end">

          <Button
            type="button"
            onClick={onNext}
          >
            Continuar

            <ChevronRight
              size={18}
              className="ml-2"
            />

          </Button>

        </div>

      </div>

    </div>
  );
}