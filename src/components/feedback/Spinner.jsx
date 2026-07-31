export default function Spinner({
  size = 20,
  color = "border-black",
}) {
  return (
    <div
      className={`
        animate-spin
        rounded-full
        border-2
        border-zinc-300
        ${color}
        border-t-transparent
      `}
      style={{
        width: size,
        height: size,
      }}
    />
  );
}
