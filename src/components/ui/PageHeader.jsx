export default function PageHeader({
  eyebrow,
  title,
  description,
  children,
  compact = false,
}) {
  return (
    <div
      className={`
        ${compact ? "mb-0 gap-4 lg:mb-0" : "mb-10 gap-8 lg:mb-12"}
        flex
        flex-col
        lg:flex-row
        lg:items-end
        lg:justify-between
      `}
    >
      <div className="min-w-0">

        {eyebrow && (
          <p className={`${compact ? "mb-2" : "mb-4"} text-xs uppercase tracking-[0.35em] text-zinc-500`}>
            {eyebrow}
          </p>
        )}

        <h1
          className="
            text-3xl
            font-semibold
            tracking-tight
            text-white

            sm:text-4xl

            lg:text-5xl
          "
        >
          {title}
        </h1>

        {description && (
          <p
            className={`
              ${compact ? "mt-2" : "mt-4"}
              max-w-3xl
              text-sm
              leading-7
              text-zinc-500

              sm:text-base

              lg:text-lg
              lg:leading-8
            `}
          >
            {description}
          </p>
        )}
      </div>

      {children && (
        <div className="w-full lg:w-auto">
          {children}
        </div>
      )}
    </div>
  );
}
