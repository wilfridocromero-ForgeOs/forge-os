export default function Logo({
  size = "default",
}) {
  const title = {
    small: "text-3xl",
    default: "text-5xl",
    large: "text-6xl",
  };

  return (
    <div className="text-center">

      <h1
        className={`
          ${title[size]}

          font-semibold

          tracking-[0.45em]

          text-white
        `}
      >
        ORVESEN
      </h1>

      <p
        className="
          mt-5

          text-xs

          uppercase

          tracking-[0.45em]

          text-zinc-500
        "
      >
        Enterprise Intelligence
      </p>

    </div>
  );
}