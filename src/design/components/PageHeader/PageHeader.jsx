import clsx from "clsx";

export default function PageHeader({
  title,
  subtitle,
  actions,
  className = "",
}) {
  return (
    <header
      className={clsx(
        "flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between",
        className
      )}
    >
      <div className="space-y-2">
        <h1 className="text-5xl font-semibold tracking-tight text-white">
          {title}
        </h1>

        {subtitle && (
          <p className="max-w-2xl text-base text-zinc-400">
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex shrink-0 items-center gap-3">
          {actions}
        </div>
      )}
    </header>
  );
}