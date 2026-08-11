export default function Button({
  children,
  variant = "primary",
  type = "button",
  className = "",
  ...props
}) {
  const styles = {
    primary:
      "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200",

    secondary:
      "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800",

    danger:
      "bg-red-600 text-white hover:bg-red-700",
  };

  return (
    <button
      type={type}
      className={`
        inline-flex
        items-center
        justify-center
        rounded-xl
        px-5
        py-3
        font-semibold
        transition
        disabled:cursor-not-allowed
        disabled:opacity-50
        ${styles[variant]}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  );
}