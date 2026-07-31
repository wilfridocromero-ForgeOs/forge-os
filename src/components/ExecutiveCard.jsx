import { ArrowUpRight } from "lucide-react";

import Card from "./ui/Card";

export default function ExecutiveCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
}) {
  return (
    <Card
      className="
        p-8

        min-h-[230px]

        flex
        flex-col
        justify-between
      "
    >
      {/* Header */}

      <div className="flex items-start justify-between">

        <div>

          <p
            className="
              text-[11px]
              uppercase
              tracking-[0.35em]

              text-zinc-500
            "
          >
            {title}
          </p>

        </div>

        <div
          className="
            flex

            h-14
            w-14

            items-center
            justify-center

            rounded-2xl

            border
            border-zinc-800

            bg-zinc-900
          "
        >
          <Icon
            size={22}
            className="text-zinc-300"
          />
        </div>

      </div>

      {/* Value */}

      <div className="mt-8">

        <h2
          className="
            text-5xl

            font-semibold

            tracking-tight

            text-white
          "
        >
          {value}
        </h2>

        <p
          className="
            mt-3

            text-sm

            leading-7

            text-zinc-500
          "
        >
          {subtitle}
        </p>

      </div>

      {/* Footer */}

      <div
        className="
          mt-10

          flex
          items-center
          justify-between

          border-t
          border-zinc-800

          pt-5
        "
      >
        <div
          className="
            flex
            items-center
            gap-2
          "
        >
          <ArrowUpRight
            size={16}
            className="text-emerald-400"
          />

          <span
            className="
              text-sm

              font-medium

              text-emerald-400
            "
          >
            {trend}
          </span>

        </div>

        <button
          className="
            text-sm

            text-zinc-500

            transition-colors

            hover:text-white
          "
        >
          Ver más →
        </button>

      </div>

    </Card>
  );
}