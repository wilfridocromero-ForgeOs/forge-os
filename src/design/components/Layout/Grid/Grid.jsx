import clsx from "clsx";

const columns = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
  7: "grid-cols-7",
  8: "grid-cols-8",
  9: "grid-cols-9",
  10: "grid-cols-10",
  11: "grid-cols-11",
  12: "grid-cols-12",
};

const gaps = {
  none: "gap-0",
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
  start: "justify-items-start",
  center: "justify-items-center",
  end: "justify-items-end",
  stretch: "justify-items-stretch",
};

export default function Grid({
  children,
  cols = {
    mobile: 1,
    tablet: 2,
    desktop: 4,
  },
  gap = "md",
  align = "stretch",
  justify = "stretch",
  className = "",
}) {
  const {
    mobile = 1,
    tablet = mobile,
    desktop = tablet,
  } = cols;

  return (
    <div
      className={clsx(
        "grid",

        columns[mobile],
        `md:${columns[tablet]}`,
        `xl:${columns[desktop]}`,

        gaps[gap],

        alignments[align],
        justifications[justify],

        className
      )}
    >
      {children}
    </div>
  );
}