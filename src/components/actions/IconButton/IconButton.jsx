import clsx from "clsx";

const variants = {
  primary:
    "bg-white text-black hover:bg-zinc-200 active:bg-zinc-300",

  secondary:
    "border border-zinc-700 bg-zinc-900 text-white hover:bg-zinc-800",

  ghost:
    "bg-transparent text-zinc-400 hover:bg-zinc-900 hover:text-white",

  danger:
    "bg-red-600 text-white hover:bg-red-500",
};

const sizes = {
  sm: "h-9 w-9",
  md: "h-11 w-11",
  lg: "h-12 w-12",
};

export default function IconButton({
  children,
  variant = "ghost",
  size = "md",
  rounded = "xl",
  loading = false,
  disabled = false,
  className = "",
  ...props
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center",
        "transition-all duration-200",
        "focus:outline-none",
        "focus:ring-2 focus:ring-white/15",
        "disabled:pointer-events-none",
        "disabled:opacity-50",
        rounded === "full" ? "rounded-full" : "rounded-2xl",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        children
      )}
    </button>
  );
}