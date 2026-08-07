import { Plus } from "lucide-react";

export default function BuilderHeader({
    onCreate,
}) {
    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">

            <div>

                <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
                    ORVESEN Intelligence
                </p>

                <h1 className="mt-2 text-3xl font-semibold text-white">
                    Score Builder
                </h1>

                <p className="mt-2 max-w-2xl text-zinc-400">
                    Diseña las evaluaciones que calcularán el Score real
                    de cada división de ORVESEN.
                </p>

            </div>

            <button
                onClick={onCreate}
                className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 font-medium text-black"
            >
                <Plus size={18} />
                Nueva evaluación
            </button>

        </div>
    );
}