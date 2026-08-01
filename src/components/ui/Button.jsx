import Spinner from "../feedback/Spinner";

export default function Button({
  children,
  loading = false,
  variant = "primary",
  disabled = false,
  className = "",
  ...props
}) {
  const variants = {
    primary: `
      bg-white
      text-black
      border-white
      hover:bg-zinc-200
    `,

    secondary: `
      bg-[#17171A]
      text-white
      border-zinc-800
      hover:border-zinc-700
      hover:bg-[#1D1D21]
    `,

    ghost: `
      bg-transparent
      text-zinc-300
      border-transparent
      hover:bg-zinc-900
    `,
  };

  return (
    <button
      disabled={loading || disabled}
      className={`
        group

        relative

        inline-flex
        items-center
        justify-center

        gap-2

        rounded-2xl

        border

        px-6
        py-3.5

        text-sm
        font-semibold

        transition-all
        duration-300

        hover:-translate-y-[1px]

        active:translate-y-0

        disabled:opacity-50
        disabled:pointer-events-none

        ${variants[variant]}

        ${className}
      `}
      {...props}
    >
      {loading ? (
        <Spinner size={18} />
      ) : (
        children
      )}
    </button>
  );
}