import clsx from "clsx";

const variants = {
  neutral:
    "border border-zinc-700 bg-zinc-900 text-zinc-300",

  primary:
    "bg-white text-black",

  success:
    "border border-emerald-500/20 bg-emerald-500/15 text-emerald-400",

  warning:
    "border border-amber-500/20 bg-amber-500/15 text-amber-400",

  danger:
    "border border-red-500/20 bg-red-500/15 text-red-400",

  info:
    "border border-sky-500/20 bg-sky-500/15 text-sky-400",
};

const sizes = {
  sm: "h-6 px-2.5 text-xs",
  md: "h-7 px-3 text-sm",
  lg: "h-8 px-4 text-sm",
};

const dots = {
  neutral: "bg-zinc-400",
  primary: "bg-black",
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  danger: "bg-red-400",
  info: "bg-sky-400",
};

export default function Badge({
  children,
  variant = "neutral",
  size = "md",
  rounded = true,
  dot = false,
  uppercase = false,
  leftIcon,
  rightIcon,
  className = "",
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center gap-2",
        "font-medium whitespace-nowrap transition-colors",

        rounded ? "rounded-full" : "rounded-xl",

        uppercase && "uppercase tracking-wide",

        variants[variant],
        sizes[size],

        className
      )}
    >
      {dot && (
        <span
          className={clsx(
            "h-2 w-2 rounded-full",
            dots[variant]
          )}
        />
      )}

      {leftIcon}

      {children}

      {rightIcon}
    </span>
  );
}