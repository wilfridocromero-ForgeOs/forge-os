import Card from "../ui/Card";

export default function MetricCard({
  icon: Icon,
  title,
  value,
  subtitle,
  trend,
}) {
  return (
    <Card className="h-full">

      <div className="flex h-full flex-col">

        {/* Header */}

        <div className="flex items-center justify-between">

          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            {title}
          </p>

          {Icon && (
            <div
              className="
                flex
                h-11
                w-11
                items-center
                justify-center

                rounded-2xl

                border
                border-zinc-800

                bg-zinc-900
              "
            >
              <Icon
                size={18}
                className="text-zinc-300"
              />
            </div>
          )}

        </div>

        {/* Valor */}

        <div className="mt-8">

          <h2 className="text-5xl font-semibold tracking-tight text-white">
            {value}
          </h2>

          <p className="mt-4 leading-7 text-zinc-400">
            {subtitle}
          </p>

        </div>

        <div className="flex-1" />

        {/* Footer */}

        <div
          className="
            mt-10

            flex
            items-center
            justify-between

            border-t
            border-zinc-800

            pt-6
          "
        >

          <span className="text-sm text-zinc-500">
            Tendencia
          </span>

          <span className="font-medium text-white">
            {trend}
          </span>

        </div>

      </div>

    </Card>
  );
}