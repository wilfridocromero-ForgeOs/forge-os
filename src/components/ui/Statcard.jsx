import { ArrowUpRight } from "lucide-react";

export default function StatCard({
  title,
  value,
  change,
  icon: Icon,
  children,
}) {
  return (
    <div
      className="
        group
        relative
        overflow-hidden
        rounded-3xl
        border
        border-zinc-800
        bg-[#111113]
        p-7
        transition-all
        duration-300
        hover:-translate-y-1
        hover:border-zinc-700
        hover:shadow-2xl
      "
    >
      {/* Glow */}

      <div
        className="
          absolute
          inset-0
          opacity-0
          transition-opacity
          duration-300
          group-hover:opacity-100
          bg-gradient-to-br
          from-white/[0.03]
          via-transparent
          to-transparent
        "
      />

      <div className="relative">

        <div className="flex items-center justify-between">

          <div>

            <p className="text-sm text-zinc-500">
              {title}
            </p>

            <h2 className="mt-5 text-5xl font-semibold tracking-tight">
              {value}
            </h2>

          </div>

          {Icon && (
            <div
              className="
                flex
                h-12
                w-12
                items-center
                justify-center
                rounded-2xl
                border
                border-zinc-800
                bg-zinc-900
              "
            >
              <Icon size={20} />
            </div>
          )}

        </div>

        <div className="mt-7 flex items-center gap-2">

          <ArrowUpRight
            size={16}
            className="text-green-400"
          />

          <span className="text-sm text-green-400">
            {change}
          </span>

        </div>

        {children && (
          <div className="mt-8">
            {children}
          </div>
        )}

      </div>
    </div>
  );
}