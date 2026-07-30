export default function Page({
  children,
  className = "",
}) {
  return (
    <main
      className={`
        mx-auto
        w-full
        max-w-7xl
        px-10
        py-10
        space-y-10
        ${className}
      `}
    >
      {children}
    </main>
  );
}