export default function Card({
  children,
  className = "",
  hover = true,
  glow = false,
}) {
  return (
    <section
      className={`
        group
        relative
        overflow-hidden

        rounded-[28px]

        border
        border-zinc-800

        bg-[#111113]

        transition-all
        duration-500
        ease-out

        ${
          hover
            ? `
              hover:-translate-y-1
              hover:scale-[1.005]

              hover:border-zinc-600

              hover:shadow-[0_35px_100px_rgba(0,0,0,.55)]
            `
            : ""
        }

        ${className}
      `}
    >
      {/* Gradiente superior */}

      <div
        className="
          pointer-events-none

          absolute
          inset-0

          bg-gradient-to-b

          from-white/[0.035]
          via-transparent
          to-transparent
        "
      />

      {/* Glow metálico */}

      {glow && (
        <div
          className="
            pointer-events-none

            absolute
            inset-0

            opacity-0

            transition-opacity
            duration-500

            group-hover:opacity-100
          "
        >
          <div
            className="
              absolute

              left-1/2
              top-0

              h-52
              w-52

              -translate-x-1/2

              rounded-full

              bg-white/[0.045]

              blur-3xl
            "
          />
        </div>
      )}

      {/* Línea metálica superior */}

      <div
        className="
          pointer-events-none

          absolute

          left-10
          right-10
          top-0

          h-px

          bg-gradient-to-r

          from-transparent
          via-white/25
          to-transparent

          opacity-0

          transition-opacity
          duration-500

          group-hover:opacity-100
        "
      />

      {/* Borde interior */}

      <div
        className="
          pointer-events-none

          absolute
          inset-0

          rounded-[28px]

          ring-1
          ring-inset

          ring-white/[0.03]
        "
      />

      {/* Reflejo lateral */}

      <div
        className="
          pointer-events-none

          absolute

          -left-24
          top-0

          h-full
          w-24

          rotate-12

          bg-gradient-to-r

          from-transparent
          via-white/[0.02]
          to-transparent

          opacity-0

          transition-all
          duration-700

          group-hover:left-[120%]
          group-hover:opacity-100
        "
      />

      {/* Contenido */}

      <div className="relative z-10 p-8">
        {children}
      </div>
    </section>
  );
}