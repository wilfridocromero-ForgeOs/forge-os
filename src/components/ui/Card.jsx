export default function Card({
  children,
  className = "",
  hover = true,
  padding = "p-8",
}) {
  return (
    <div
      className={`
        rounded-[32px]
        border
        border-zinc-900
        bg-zinc-950/70
        backdrop-blur
        ${padding}
        transition-all
        duration-300
        ${hover ? "hover:border-zinc-700" : ""}
        ${className}
      `}
    >
      {children}
    </div>
  );
}