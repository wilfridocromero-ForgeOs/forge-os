import clsx from "clsx";

const spacings = {
  sm: "gap-4",
  md: "gap-6",
  lg: "gap-8",
};

export default function Section({
  title,
  description,
  actions,
  children,
  spacing = "md",
  className = "",
}) {
  return (
    <section
      className={clsx(
        "flex flex-col",
        spacings[spacing],
        className
      )}
    >
      {(title || description || actions) && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            {title && (
              <h2 className="text-xl font-semibold tracking-tight text-white">
                {title}
              </h2>
            )}

            {description && (
              <p className="max-w-2xl text-sm leading-6 text-zinc-400">
                {description}
              </p>
            )}
          </div>

          {actions && (
            <div className="flex shrink-0 items-center gap-3">
              {actions}
            </div>
          )}
        </div>
      )}

      {children}
    </section>
  );
}