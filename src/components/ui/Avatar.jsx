export default function Avatar({
  name = "",
  src,
  size = "md",
  status,
  className = "",
}) {
  const sizes = {
    xs: "h-9 w-9 text-xs rounded-xl",

    sm: "h-11 w-11 text-sm rounded-xl",

    md: "h-14 w-14 text-lg rounded-2xl",

    lg: "h-16 w-16 text-xl rounded-2xl",

    xl: "h-20 w-20 text-2xl rounded-3xl",
  };

  return (
    <div className={`relative ${className}`}>

      {/* Avatar */}

      <div
        className={`
          group

          relative

          flex
          items-center
          justify-center

          overflow-hidden

          border
          border-zinc-700

          bg-gradient-to-br
          from-zinc-700
          via-zinc-800
          to-[#09090B]

          text-white
          font-semibold

          shadow-[0_20px_50px_rgba(0,0,0,.35)]

          transition-all
          duration-300

          hover:border-zinc-500
          hover:shadow-[0_30px_70px_rgba(0,0,0,.45)]

          ${sizes[size]}
        `}
      >

        {/* Reflejo superior */}

        <div
          className="
            pointer-events-none

            absolute
            inset-0

            bg-gradient-to-b

            from-white/[0.08]

            via-transparent

            to-transparent
          "
        />

        {/* Imagen */}

        {src ? (
          <img
            src={src}
            alt={name}
            className="
              h-full
              w-full

              object-cover
            "
          />
        ) : (
          <span className="relative z-10">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>

      {/* Indicador de estado */}

      {status && (
        <span
          className="
            absolute

            bottom-0
            right-0

            h-4
            w-4

            rounded-full

            border-2
            border-[#111113]

            bg-emerald-500
          "
        />
      )}
    </div>
  );
}