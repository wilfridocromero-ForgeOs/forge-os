export default function Logo({
  size = "default",
  compact = false,
}) {
  const title = {
    small: "text-3xl",
    default: "text-5xl",
    large: "text-6xl",
  };

  return (
    <div className={`flex items-center ${compact ? "gap-3 text-left" : "flex-col text-center"}`}>

      <img
        src="/orvesen-mark.png"
        alt="Símbolo de ORVESEN"
        className={`${compact ? "h-12 w-12" : "mb-4 h-20 w-20 sm:h-24 sm:w-24"} object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.35)]`}
      />

      <div>

      <h1
        className={`
          ${compact ? "text-xl sm:text-2xl" : title[size]}

          font-semibold

          ${compact ? "tracking-[0.28em]" : "tracking-[0.45em]"}

          text-white
        `}
      >
        ORVESEN
      </h1>

      <p
        className={`${compact ? "mt-1" : "mt-5"} text-xs uppercase ${compact ? "tracking-[0.22em]" : "tracking-[0.45em]"} text-zinc-500`}
      >
        Enterprise Intelligence
      </p>

      </div>

    </div>
  );
}
