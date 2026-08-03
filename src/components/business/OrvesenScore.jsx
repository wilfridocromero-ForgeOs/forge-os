import Card from "../ui/Card";

export default function ScoreGauge({
  score = null,
  max = 1000,
  status = "Organización Saludable",
  improvement = null,
  description = "",
  loading = false,
}) {
  const hasScore = Number.isFinite(Number(score));
  const safeScore = hasScore ? Number(score) : 0;
  const percentage = Math.min(100, Math.max(0, (safeScore / max) * 100));

  return (
    <Card className="relative overflow-hidden">

      {/* Glow muy sutil */}

      <div
        className="
          absolute
          -top-32
          left-1/2
          h-64
          w-64
          -translate-x-1/2
          rounded-full
          bg-white/5
          blur-3xl
          pointer-events-none
        "
      />

      <div className="relative">

        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          ORVESEN SCORE
        </p>

        <div className="mt-10 flex items-center justify-center">

          <div className="relative h-64 w-64">

            {/* Círculo exterior */}

            <svg
              viewBox="0 0 220 220"
              className="h-full w-full rotate-[-90deg]"
            >
              <circle
                cx="110"
                cy="110"
                r="92"
                fill="none"
                stroke="#27272A"
                strokeWidth="10"
              />

              <circle
                cx="110"
                cy="110"
                r="92"
                fill="none"
                stroke="white"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={578}
                strokeDashoffset={
                  578 - (578 * percentage) / 100
                }
              />
            </svg>

            {/* Centro */}

            <div
              className="
                absolute
                inset-0

                flex
                flex-col
                items-center
                justify-center
              "
            >
              <h1 className="text-6xl font-semibold tracking-tight text-white">
                {loading ? "…" : hasScore ? safeScore : "—"}
              </h1>

              <p className="mt-3 text-sm uppercase tracking-[0.25em] text-zinc-400">
                {loading ? "Calculando" : hasScore ? status : "Evaluación pendiente"}
              </p>

              {!loading && improvement !== null && improvement !== undefined && (
                <p className="mt-5 text-sm text-zinc-500">
                  {Number(improvement) >= 0 ? "↑ +" : "↓ "}{improvement} este mes
                </p>
              )}
            </div>

          </div>

        </div>

        <p
          className="
            mx-auto
            mt-10
            max-w-xl
            text-center
            leading-8
            text-zinc-400
          "
        >
          {description}
        </p>

      </div>

    </Card>
  );
}
