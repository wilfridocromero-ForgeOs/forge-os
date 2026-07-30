import clsx from "clsx";

const sizes = {
  xs: "h-8 w-8 text-xs",
  sm: "h-10 w-10 text-sm",
  md: "h-12 w-12 text-base",
  lg: "h-16 w-16 text-lg",
  xl: "h-20 w-20 text-xl",
};

const statuses = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  busy: "bg-red-500",
  offline: "bg-zinc-500",
};

function getInitials(name = "") {
  return name
    .trim()
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export default function Avatar({
  src,
  alt = "",
  name = "",
  initials,
  status,
  size = "md",
  rounded = "full",
  onClick,
  className = "",
}) {
  const avatarInitials = initials || getInitials(name);

  return (
    <div
      onClick={onClick}
      className={clsx(
        "relative inline-flex shrink-0",
        sizes[size],
        onClick && "cursor-pointer",
        className
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt || name}
          className={clsx(
            "h-full w-full object-cover bg-zinc-900",
            rounded === "full" ? "rounded-full" : "rounded-2xl"
          )}
        />
      ) : (
        <div
          className={clsx(
            "flex h-full w-full items-center justify-center",
            "bg-zinc-800 text-zinc-200 font-semibold select-none",
            rounded === "full" ? "rounded-full" : "rounded-2xl"
          )}
        >
          {avatarInitials}
        </div>
      )}

      {status && (
        <span
          className={clsx(
            "absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-[#090909]",
            statuses[status]
          )}
        />
      )}
    </div>
  );
}