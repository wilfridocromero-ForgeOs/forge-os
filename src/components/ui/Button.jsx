export default function Button({
  children,
  variant = "primary",
  className = "",
  disabled = false,
  ...props
}) {
  const variants = {
    primary:
      "bg-white text-black hover:bg-zinc-200",

    secondary:
      "border border-zinc-700 bg-transparent text-white hover:bg-zinc-800",

    ghost:
      "text-zinc-400 hover:text-white hover:bg-zinc-900",
  };

  return (
    <button
      disabled={disabled}
      className={`
        inline-flex
        items-center
        justify-center
        gap-2

        h-12
        px-6

        rounded-xl

        text-sm
        font-medium

        transition-all
        duration-300
        ease-out

        disabled:opacity-50
        disabled:cursor-not-allowed

        ${variants[variant]}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
}