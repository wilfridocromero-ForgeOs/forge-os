import clsx from "clsx";

const maxWidths = {
  sm: "max-w-3xl",
  md: "max-w-5xl",
  lg: "max-w-6xl",
  xl: "max-w-7xl",
  full: "max-w-full",
};

export default function Page({
  children,
  maxWidth = "xl",
  className = "",
}) {
  return (
    <main
      className={clsx(
        "mx-auto w-full px-6 py-8 lg:px-8 lg:py-10",
        maxWidths[maxWidth],
        className
      )}
    >
      {children}
    </main>
  );
}