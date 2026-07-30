import clsx from "clsx";

const spacing = {
  none: "",
  sm: "my-4",
  md: "my-6",
  lg: "my-8",
  xl: "my-10",
};

export default function Divider({
  spacingY = "md",
  className = "",
}) {
  return (
    <hr
      className={clsx(
        "border-0 border-t border-zinc-800",
        spacing[spacingY],
        className
      )}
    />
  );
}