import Spinner from "../../feedback/Spinner";

export default function Button({
  children,
  loading = false,
  onClick,
  type = "button",
  disabled = false,
  className = "",
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={loading || disabled}
      className={`
        flex
        items-center
        justify-center
        gap-2

        w-full

        rounded-2xl

        bg-white

        px-6
        py-4

        text-sm
        font-semibold

        text-black

        transition-all
        duration-300

        hover:bg-zinc-200
        hover:scale-[1.01]

        active:scale-[0.99]

        disabled:cursor-not-allowed
        disabled:opacity-60

        ${className}
      `}
    >
      {loading ? (
        <>
          <Spinner size={18} />
          Cargando...
        </>
      ) : (
        children
      )}
    </button>
  );
}