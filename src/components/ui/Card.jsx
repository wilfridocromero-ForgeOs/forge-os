export default function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  hover = true,
  variant = "default",
  padding = "default",
}) {
  const variants = {
    default: "bg-[#111113] border-zinc-800",

    outlined: `
      bg-transparent
      border-zinc-800
    `,

    glass: `
      bg-white/[0.02]
      backdrop-blur-xl
      border-white/10
    `,
  };

  const paddings = {
    none: "",
    sm: "p-5",
    default: "p-6 sm:p-8",
    lg: "p-8 sm:p-10",
  };

  return (
    <section
      className={`
        group
        relative
        overflow-hidden

        rounded-3xl

        border

        ${variants[variant]}

        transition-all
        duration-200
        ease-out

        ${
          hover
            ? `
              hover:-translate-y-[2px]
              hover:border-zinc-700
              hover:shadow-[0_24px_70px_rgba(0,0,0,.35)]
            `
            : ""
        }

        ${className}
      `}
    >
      {/* Glow */}

      <div
        className="
          pointer-events-none

          absolute
          inset-0

          rounded-3xl

          opacity-0

          transition-opacity
          duration-500

          group-hover:opacity-100

          bg-gradient-to-br
          from-white/[0.025]
          via-transparent
          to-transparent
        "
      />

      {(title || subtitle || actions) && (
        <header
          className="
            relative

            flex
            flex-col
            gap-6

            border-b
            border-zinc-800

            p-6

            sm:flex-row
            sm:items-start
            sm:justify-between

            lg:px-8
            lg:py-6
          "
        >
          <div className="min-w-0">

            {title && (
              <h2
                className="
                  text-xl
                  font-semibold
                  tracking-tight
                  text-white
                "
              >
                {title}
              </h2>
            )}

            {subtitle && (
              <p
                className="
                  mt-2

                  text-sm
                  leading-7

                  text-zinc-500
                "
              >
                {subtitle}
              </p>
            )}

          </div>

          {actions && (
            <div className="w-full sm:w-auto">
              {actions}
            </div>
          )}

        </header>
      )}

      <div
        className={`
          relative
          ${paddings[padding]}
        `}
      >
        {children}
      </div>

    </section>
  );
}