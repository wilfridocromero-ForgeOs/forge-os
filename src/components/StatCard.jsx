import { ChevronRight } from "lucide-react";

function StatCard({
  icon: Icon,
  title,
  value,
  subtitle,
}) {
  return (
    <div className="group rounded-3xl border border-zinc-800 bg-zinc-900 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-zinc-700">

      <div className="flex items-center justify-between">

        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-800">

          <Icon
            size={22}
            className="text-white"
          />

        </div>

        <ChevronRight
          size={18}
          className="text-zinc-600 transition group-hover:text-white"
        />

      </div>

      <p className="mt-8 text-sm uppercase tracking-[0.20em] text-zinc-500">
        {title}
      </p>

      <h2 className="mt-3 text-4xl font-semibold text-white">
        {value}
      </h2>

      <p className="mt-3 text-sm text-zinc-500">
        {subtitle}
      </p>

    </div>
  );
}

export default StatCard;