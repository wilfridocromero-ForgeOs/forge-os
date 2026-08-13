import Card from "../ui/Card";

export default function MetricCard({
  icon: Icon,
  title,
  value,
  subtitle,
  trend,
  loading = false,
  compact = false,
}) {
  return (
    <Card className="h-full" contentClassName={compact ? "p-3.5 sm:p-4" : "p-4 sm:p-5"}>

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
                h-8
                w-8
                items-center
                justify-center

                rounded-2xl

                border
                border-zinc-800

                bg-zinc-900
              "
            >
              <Icon
                size={16}
                className="text-zinc-300"
              />
            </div>
          )}

        </div>

        {/* Valor */}

        <div className={compact ? "mt-2" : "mt-3"}>

          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {loading ? "…" : value}
          </h2>

          <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
            {subtitle}
          </p>

        </div>

        {trend && (
          <p className="mt-4 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
            {trend}
          </p>
        )}

      </div>

    </Card>
  );
}
