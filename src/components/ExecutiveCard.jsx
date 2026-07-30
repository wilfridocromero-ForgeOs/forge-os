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
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
            {title}
          </p>

          <h2 className="mt-4 text-4xl font-semibold text-white">
            {value}
          </h2>

          <p className="mt-2 text-sm text-zinc-500">
            {subtitle}
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <Icon
            size={26}
            className="text-zinc-300"
          />
        </div>
      </div>

      <div className="mt-8 flex items-center gap-2">
        <ArrowUpRight
          size={16}
          className="text-emerald-400"
        />

        <span className="text-sm text-emerald-400">
          {trend}
        </span>
      </div>
    </Card>
  );
}

export default ExecutiveCard;