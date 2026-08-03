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
    <div className={`flex items-center ${compact ? "w-full justify-center gap-2.5 text-left" : "flex-col text-center"}`}>

      <img
        src="/orvesen-mark.png"
        alt="Símbolo de ORVESEN"
        className={`${compact ? "h-10 w-10 shrink-0" : "mb-3 h-16 w-16 sm:h-20 sm:w-20"} object-contain drop-shadow-[0_8px_20px_rgba(0,0,0,0.35)]`}
      />

      <div>

      <h1
        className={`
          ${compact ? "text-lg sm:text-xl" : `${size === "default" ? "text-3xl sm:text-5xl" : title[size]}`}

          font-semibold

          ${compact ? "tracking-[0.2em]" : "pl-[0.32em] tracking-[0.32em] sm:pl-[0.4em] sm:tracking-[0.4em]"}

          text-white
        `}
      >
        ORVESEN
      </h1>

      <p
        className={`${compact ? "mt-1 text-[9px] tracking-[0.16em]" : "mt-3 pl-[0.25em] text-[10px] tracking-[0.25em] sm:mt-4 sm:pl-[0.35em] sm:text-xs sm:tracking-[0.35em]"} uppercase text-zinc-500`}
      >
        Enterprise Intelligence
      </p>

      </div>

    </div>
  );
}
