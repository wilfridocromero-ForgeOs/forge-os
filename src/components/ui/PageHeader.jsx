export default function PageHeader({
  eyebrow,
  title,
  description,
  children,
}) {
  return (
    <div
      className="
        mb-10
        flex
        flex-col
        gap-8

        lg:mb-12
        lg:flex-row
        lg:items-end
        lg:justify-between
      "
    >
      <div className="min-w-0">

        {eyebrow && (
          <p className="mb-4 text-xs uppercase tracking-[0.35em] text-zinc-500">
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
            className="
              mt-4
              max-w-3xl
              text-sm
              leading-7
              text-zinc-500

              sm:text-base

              lg:text-lg
              lg:leading-8
            "
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