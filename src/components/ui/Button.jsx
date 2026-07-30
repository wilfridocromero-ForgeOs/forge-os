export default function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}) {
  const variants = {
    primary:
      "bg-white text-black hover:bg-zinc-200",

    secondary:
      "bg-zinc-900 text-white border border-zinc-800 hover:bg-zinc-800",

    ghost:
      "bg-transparent text-zinc-300 hover:bg-zinc-900",
  };

  const sizes = {
    sm: "h-9 px-4 text-sm",
    md: "h-11 px-5 text-sm",
    lg: "h-12 px-6 text-base",
  };

  return (
    <button
      className={`
        inline-flex
        items-center
        justify-center
        rounded-xl
        font-medium
        transition-all
        duration-200
        focus:outline-none
        focus:ring-2
        focus:ring-white/20
        disabled:opacity-50
        disabled:pointer-events-none
        ${variants[variant]}
        ${sizes[size]}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
}<Button>
    Nuevo cliente
</Button>