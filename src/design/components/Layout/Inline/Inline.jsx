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

const justifications = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
};

const wraps = {
  wrap: "flex-wrap",
  nowrap: "flex-nowrap",
};

export default function Inline({
  children,
  spacing = "md",
  align = "center",
  justify = "start",
  wrap = "wrap",
  className = "",
}) {
  return (
    <div
      className={clsx(
        "flex",
        spacings[spacing],
        alignments[align],
        justifications[justify],
        wraps[wrap],
        className
      )}
    >
      {children}
    </div>
  );
}