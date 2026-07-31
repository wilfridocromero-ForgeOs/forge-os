export default function ErrorMessage({ children }) {
  if (!children) return null;

  return (
    <div
      className="
        rounded-xl
        border
        border-red-500/20
        bg-red-500/10
        px-4
        py-3
        text-sm
        text-red-300
      "
    >
      {children}
    </div>
  );
}