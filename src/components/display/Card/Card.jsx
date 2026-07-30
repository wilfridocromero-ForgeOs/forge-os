import clsx from "clsx";

function Card({
  children,
  className = "",
  padding = "lg",
  border = true,
  clickable = false,
  elevated = false,
}) {
  return (
    <section
      className={clsx(
        "rounded-3xl bg-[#111113] transition-all duration-300",

        border && "border border-zinc-800",

        padding === "sm" && "p-4",
        padding === "md" && "p-6",
        padding === "lg" && "p-8",

        clickable &&
          "cursor-pointer hover:border-zinc-700 hover:-translate-y-0.5",

        elevated && "shadow-[0_24px_60px_rgba(0,0,0,.30)]",

        className
      )}
    >
      {children}
    </section>
  );
}

export default Card;