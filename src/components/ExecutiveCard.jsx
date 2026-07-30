import { ArrowUpRight } from "lucide-react";
import Card from "./ui/Card";

function ExecutiveCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
}) {
  return (
    <Card
      className="
        flex
        h-full
        min-h-[240px]
        flex-col

        p-5
        sm:p-6
        lg:p-7
      "
    >
      {/* Parte superior */}

      <div className="flex items-start justify-between gap-5">

        <div className="min-w-0 flex-1">

          <p
            className="
              text-[11px]
              font-medium
              uppercase
              tracking-[0.30em]
              text-zinc-500
            "
          >
            {title}
          </p>

          <h2
            className="
              mt-4

              text-3xl
              sm:text-4xl

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
              leading-6

              text-zinc-500
            "
          >
            {subtitle}
          </p>

        </div>

        <div
          className="
            flex
            h-14
            w-14
            shrink-0

            items-center
            justify-center

            rounded-2xl

            border
            border-zinc-800

            bg-zinc-900

            transition-colors
            duration-200

            group-hover:border-zinc-700
          "
        >
          <Icon
            size={24}
            className="text-zinc-300"
          />
        </div>

      </div>

      {/* Empuja el footer abajo */}

      <div className="flex-1" />

      {/* Footer */}

      <div
        className="
          mt-8

          flex
          items-center
          gap-2

          border-t
          border-zinc-800

          pt-5
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

    </Card>
  );
}

export default ExecutiveCard;