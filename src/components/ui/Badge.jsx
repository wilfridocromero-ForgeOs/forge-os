export default function Badge({
  children,
  color = "default",
}) {

  const colors = {
    default:
      "bg-zinc-800 text-zinc-300",

    success:
      "bg-green-500/10 text-green-400",

    warning:
      "bg-yellow-500/10 text-yellow-400",

    danger:
      "bg-red-500/10 text-red-400",

    info:
      "bg-blue-500/10 text-blue-400",
  };

  return (
    <span
      className={`
        inline-flex
        items-center
        rounded-full
        px-3
        py-1
        text-xs
        font-medium
        ${colors[color]}
      `}
    >
      {children}
    </span>
  );
}