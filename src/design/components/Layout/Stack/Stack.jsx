import clsx from "clsx";

const spacings = {
  xs: "gap-2",
  sm: "gap-4",
  md: "gap-6",
  lg: "gap-8",
  xl: "gap-10",
};

const alignments = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

export default function Stack({
  children,
  spacing = "md",
  align = "stretch",
  className = "",
}) {
  return (
    <div
      className={clsx(
        "flex flex-col",
        spacings[spacing],
        alignments[align],
        className
      )}
    >
      {children}
    </div>
  );
}