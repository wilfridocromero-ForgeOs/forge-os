export default function PageContainer({
  children,
}) {
  return (
    <div
      className="
        mx-auto
        max-w-[1700px]
        px-10
        py-10
      "
    >
      {children}
    </div>
  );
}