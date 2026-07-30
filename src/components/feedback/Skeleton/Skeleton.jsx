import clsx from "clsx";

const variants = {
  rounded: "rounded-2xl",
  circle: "rounded-full",
  text: "rounded-md",
};

export default function Skeleton({
  width = "100%",
  height = 16,
  variant = "rounded",
  className = "",
}) {
  return (
    <div
      className={clsx(
        "animate-pulse bg-zinc-800",
        variants[variant],
        className
      )}
      style={{
        width,
        height,
      }}
    />
  );
}