import clsx from "clsx";
import Card from "../../display/Card";
import Badge from "../../feedback/Badge";
import Button from "../../actions/Button";

const priorities = {
  low: {
    badge: "Info",
    variant: "info",
  },

  medium: {
    badge: "Media",
    variant: "warning",
  },

  high: {
    badge: "Alta",
    variant: "danger",
  },
};

export default function PriorityCard({
  title,
  description,
  priority = "medium",
  actionLabel = "Ver más",
  onAction,
  icon,
  className = "",
}) {
  const config = priorities[priority];

  return (
    <Card className={clsx("space-y-6", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-4">
          {icon && (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-300">
              {icon}
            </div>
          )}

          <div className="space-y-2">
            <Badge variant={config.variant}>
              {config.badge}
            </Badge>

            <h3 className="text-lg font-semibold text-white">
              {title}
            </h3>

            <p className="text-sm leading-6 text-zinc-400">
              {description}
            </p>
          </div>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
    </Card>
  );
}