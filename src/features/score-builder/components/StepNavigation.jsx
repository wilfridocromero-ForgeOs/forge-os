import { ArrowLeft, ArrowRight } from "lucide-react";

export default function StepNavigation({
    onBack,
    onNext,
    backLabel = "Atrás",
    nextLabel = "Continuar",
    disableNext = false,
    disableBack = false,
}) {

    return (

        <div className="mt-12 flex items-center justify-between">

            <button
                type="button"
                disabled={disableBack}
                onClick={onBack}
                className="flex items-center rounded-2xl border border-zinc-800 px-6 py-3 transition hover:bg-zinc-900 disabled:opacity-40"
            >

                <ArrowLeft
                    size={18}
                    className="mr-2"
                />

                {backLabel}

            </button>

            <button
                type="button"
                disabled={disableNext}
                onClick={onNext}
                className="flex items-center rounded-2xl bg-white px-7 py-3 font-semibold text-black transition hover:opacity-90 disabled:opacity-40"
            >

                {nextLabel}

                <ArrowRight
                    size={18}
                    className="ml-2"
                />

            </button>

        </div>

    );

}