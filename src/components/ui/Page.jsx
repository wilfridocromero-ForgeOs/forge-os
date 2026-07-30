export default function Page({
  children,
  className = "",
}) {
  return (
    <main
      className={`
        mx-auto
        w-full
        max-w-[1700px]

        px-4
        sm:px-6
        lg:px-8
        xl:px-10

        py-6
        sm:py-8
        lg:py-10

        space-y-8
        lg:space-y-10

        ${className}
      `}
    >
      {children}
    </main>
  );
}