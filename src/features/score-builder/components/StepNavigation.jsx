import { ArrowLeft, ArrowRight } from "lucide-react";

export default function StepNavigation({
    canBack = true,
    canNext = true,
    backLabel = "Anterior",
    nextLabel = "Continuar",
    onBack,
    onNext,
}) {

    return (

        <div className="mt-10 flex items-center justify-between border-t border-zinc-800 pt-6">

            <button
                onClick={onBack}
                disabled={!canBack}
                className="flex items-center gap-2 rounded-xl border border-zinc-700 px-5 py-3 text-zinc-300 disabled:opacity-40"
            >
                <ArrowLeft size={18}/>
                {backLabel}
            </button>

            <button
                onClick={onNext}
                disabled={!canNext}
                className="flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-semibold text-black disabled:opacity-40"
            >
                {nextLabel}
                <ArrowRight size={18}/>
            </button>

        </div>

    );

}