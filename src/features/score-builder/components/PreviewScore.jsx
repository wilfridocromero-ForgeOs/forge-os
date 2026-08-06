export default function PreviewScore({

    total,
    scale,

}){

    return(

        <div className="sticky top-6 rounded-3xl border border-zinc-800 bg-[#111113] p-6">

            <h2 className="text-xl font-semibold">

                Vista previa

            </h2>

            <div className="mt-8 flex justify-center">

                <div className="relative">

                    <svg width="220" height="220">

                        <circle

                            cx="110"

                            cy="110"

                            r="90"

                            stroke="#27272A"

                            strokeWidth="14"

                            fill="none"

                        />

                    </svg>

                    <div className="absolute inset-0 flex flex-col items-center justify-center">

                        <div className="text-5xl font-bold">

                            {scale}

                        </div>

                        <div className="mt-2 text-sm text-zinc-500">

                            Score Máximo

                        </div>

                    </div>

                </div>

            </div>

            <div className="mt-8 rounded-2xl bg-[#09090B] p-5">

                <div className="flex justify-between">

                    <span>Peso Total</span>

                    <span>

                        {total}%

                    </span>

                </div>

            </div>

            {

                total!==100 &&

                <p className="mt-4 text-sm text-red-400">

                    Debe sumar exactamente 100%.

                </p>

            }

        </div>

    )

}