import Spinner from "../feedback/Spinner";

export default function Button({
  children,
  loading = false,
  onClick,
  type = "button",
}) {
  return (
    <button
      type={type}
      disabled={loading}
      onClick={onClick}
      className="
        w-full

        rounded-2xl

        bg-white

        py-4

        font-semibold
        text-black

        transition-all
        duration-200

        hover:scale-[1.01]
        hover:bg-zinc-200

        active:scale-[0.99]

        disabled:opacity-70
        disabled:cursor-not-allowed
      "
    >
      {loading ? (
        <div className="flex justify-center">
          <Spinner />
        </div>
      ) : (
        children
      )}
    </button>
  );
}