import {
  MoreHorizontal,
  Mail,
  Phone,
  ArrowUpRight,
} from "lucide-react";

import Card from "../ui/Card";

export default function ClientCard({
  name,
  company,
  email,
  phone,
  status,
  score,
  discovery,
  playbooks,
  projects,
  activity,
}) {
  const progress = (score / 1000) * 100;
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset =
    circumference - (circumference * progress) / 100;

  return (
    <Card
      glow
      className="group"
    >
      <div className="flex items-start justify-between">

        {/* Cliente */}

        <div className="flex gap-5">

          {/* Avatar */}

          <div
            className="
              flex
              h-16
              w-16
              items-center
              justify-center

              rounded-2xl

              bg-gradient-to-br
              from-zinc-700
              to-zinc-900

              text-xl
              font-semibold
              text-white
            "
          >
            {name.charAt(0)}
          </div>

          <div>

            <h2 className="text-2xl font-semibold text-white">
              {name}
            </h2>

            <p className="mt-1 text-zinc-500">
              {company}
            </p>

            <div className="mt-5 flex gap-6">

              <div className="flex items-center gap-2 text-zinc-400">

                <Mail size={16} />

                <span className="text-sm">
                  {email}
                </span>

              </div>

              <div className="flex items-center gap-2 text-zinc-400">

                <Phone size={16} />

                <span className="text-sm">
                  {phone}
                </span>

              </div>

            </div>

          </div>

        </div>

        {/* Botón */}

        <button
          className="
            rounded-2xl

            border
            border-zinc-800

            bg-zinc-900

            p-3

            transition-all

            hover:border-zinc-700
            hover:bg-zinc-800
          "
        >
          <MoreHorizontal size={18} />
        </button>

      </div>

      {/* Divider */}

      <div className="my-10 h-px bg-zinc-800" />

      {/* Métricas */}

      <div
        className="
          grid

          gap-10

          md:grid-cols-5
        "
      >

        {/* Score */}

        <div className="flex flex-col items-center">

          <div className="relative">

            <svg
              width="90"
              height="90"
              className="-rotate-90"
            >
              <defs>

                <linearGradient id="scoreGradient">

                  <stop
                    offset="0%"
                    stopColor="#5B5B5B"
                  />

                  <stop
                    offset="45%"
                    stopColor="#E8E8E8"
                  />

                  <stop
                    offset="70%"
                    stopColor="#FFFFFF"
                  />

                  <stop
                    offset="100%"
                    stopColor="#BFBFBF"
                  />

                </linearGradient>

                <filter id="glow">

                  <feGaussianBlur
                    stdDeviation="2"
                  />

                </filter>

              </defs>

              <circle
                cx="45"
                cy="45"
                r={radius}
                stroke="#27272A"
                strokeWidth="7"
                fill="none"
              />

              <circle
                cx="45"
                cy="45"
                r={radius}
                stroke="url(#scoreGradient)"
                strokeWidth="7"
                strokeLinecap="round"
                fill="none"
                filter="url(#glow)"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
              />

            </svg>

            <div
              className="
                absolute
                inset-0

                flex
                items-center
                justify-center
              "
            >
              <span className="text-lg font-semibold">
                {score}
              </span>
            </div>

          </div>

          <p className="mt-4 text-sm text-zinc-500">
            ORVESEN SCORE
          </p>

        </div>

        {/* Discovery */}

        <Metric
          title="Discovery"
          value={discovery}
        />

        <Metric
          title="Playbooks"
          value={playbooks}
        />

        <Metric
          title="Proyectos"
          value={projects}
        />

        <div>

          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            Última actividad
          </p>

          <p className="mt-5 leading-7 text-zinc-300">
            {activity}
          </p>

        </div>

      </div>

      {/* Footer */}

      <div
        className="
          mt-12

          flex
          items-center
          justify-between

          border-t
          border-zinc-800

          pt-7
        "
      >

        <span
          className="
            rounded-full

            border
            border-zinc-700

            px-4
            py-2

            text-xs
            uppercase
            tracking-[0.25em]
            text-zinc-300
          "
        >
          {status}
        </span>

        <button
          className="
            flex
            items-center
            gap-2

            text-sm
            font-medium

            text-white

            transition-all

            hover:gap-3
          "
        >
          Abrir Cliente

          <ArrowUpRight size={17} />

        </button>

      </div>

    </Card>
  );
}

function Metric({
  title,
  value,
}) {
  return (
    <div>

      <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
        {title}
      </p>

      <h3 className="mt-5 text-3xl font-semibold text-white">
        {value}
      </h3>

    </div>
  );
}