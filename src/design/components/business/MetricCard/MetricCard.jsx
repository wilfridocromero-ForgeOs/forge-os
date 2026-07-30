import Card from "../Card";
import Badge from "../Badge";
import clsx from "clsx";

export default function MetricCard({
  title,
  value,
  subtitle,
  icon,
  badge,
  trend,
  trendDirection = "up",
  onClick,
  className = "",
}) {
  return (
    <Card
      className={clsx(
        "cursor-default",
        onClick && "cursor-pointer hover:-translate-y-0.5",
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm text-zinc-500">
            {title}
          </p>

          <h3 className="text-3xl font-semibold tracking-tight text-white">
            {value}
          </h3>

          {subtitle && (
            <p className="text-sm text-zinc-400">
              {subtitle}
            </p>
          )}
        </div>

        {icon && (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-300">
            {icon}
          </div>
        )}
      </div>

      {(badge || trend) && (
        <div className="mt-6 flex items-center justify-between">
          {badge}

          {trend && (
            <span
              className={clsx(
                "text-sm font-medium",
                trendDirection === "up"
                  ? "text-emerald-400"
                  : "text-red-400"
              )}
            >
              {trend}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}