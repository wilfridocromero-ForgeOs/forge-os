export default function AuthBackground() {
  return (
    <>
      {/* Fondo */}

      <div className="absolute inset-0 bg-[#09090B]" />

      {/* Glow superior */}

      <div
        className="
          absolute

          -top-64
          left-1/2

          h-[700px]
          w-[700px]

          -translate-x-1/2

          rounded-full

          bg-white/[0.025]

          blur-[180px]
        "
      />

      {/* Glow inferior */}

      <div
        className="
          absolute

          bottom-0
          right-0

          h-[500px]
          w-[500px]

          rounded-full

          bg-white/[0.015]

          blur-[160px]
        "
      />

      {/* Grid */}

      <div
        className="
          absolute
          inset-0

          opacity-[0.03]

          [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)]

          [background-size:70px_70px]
        "
      />
    </>
  );
}