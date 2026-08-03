import Card from "../ui/Card";

export default function MetricCard({
  icon: Icon,
  title,
  value,
  subtitle,
  trend,
  loading = false,
}) {
  return (
    <Card className="h-full" contentClassName="p-5 sm:p-6">

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
                h-9
                w-9
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

        <div className="mt-5">

          <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {loading ? "…" : value}
          </h2>

          <p className="mt-2 text-sm text-zinc-400">
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
