import { motion } from "framer-motion";

export default function ClientScoreRing({
  score = 867,
  max = 1000,
  size = 130,
}) {
  const stroke = 8;

  const radius = (size - stroke) / 2;

  const circumference = 2 * Math.PI * radius;

  const progress = score / max;

  const dashOffset =
    circumference - progress * circumference;

  function getStatus() {
    if (score >= 900) return "Excelente";
    if (score >= 750) return "Saludable";
    if (score >= 600) return "En crecimiento";
    return "Requiere atención";
  }

  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        width: size,
        height: size,
      }}
    >
      <svg
        width={size}
        height={size}
        className="-rotate-90"
      >
        <defs>
          <linearGradient
            id="scoreGradient"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#5F5F61" />
            <stop offset="30%" stopColor="#C5C5C5" />
            <stop offset="55%" stopColor="#FFFFFF" />
            <stop offset="80%" stopColor="#DDDDDD" />
            <stop offset="100%" stopColor="#8B8B8B" />
          </linearGradient>

          <filter
            id="scoreGlow"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur
              stdDeviation="2.8"
              result="blur"
            />

            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Círculo de fondo */}

        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#27272A"
          strokeWidth={stroke}
          fill="none"
        />

        {/* Círculo animado */}

        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="url(#scoreGradient)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          filter="url(#scoreGlow)"
          strokeDasharray={circumference}
          initial={{
            strokeDashoffset: circumference,
          }}
          animate={{
            strokeDashoffset: dashOffset,
          }}
          transition={{
            duration: 1.3,
            ease: "easeOut",
          }}
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
        <h2 className="text-4xl font-semibold text-white">
          {score}
        </h2>

        <p
          className="
            mt-1

            text-[11px]

            uppercase

            tracking-[0.35em]

            text-zinc-500
          "
        >
          SCORE
        </p>

        <p className="mt-3 text-sm text-zinc-400">
          {getStatus()}
        </p>
      </div>
    </div>
  );
}