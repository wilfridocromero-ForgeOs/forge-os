export default function Card({
  children,
  className = "",
}) {
  return (
    <div
      className={`
        rounded-2xl
        border
        border-zinc-200
        bg-white
        p-6
        text-zinc-950
        shadow-sm
        transition-colors

        dark:border-zinc-800
        dark:bg-zinc-950
        dark:text-white

        ${className}
      `}
    >
      {children}
    </div>
  );
}