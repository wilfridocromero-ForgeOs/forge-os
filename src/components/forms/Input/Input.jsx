import clsx from "clsx";

const sizes = {
  sm: "h-10 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export default function Input({
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  size = "md",
  className = "",
  ...props
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      {label && (
        <label className="text-sm font-medium text-zinc-200">
          {label}
        </label>
      )}

      <div className="relative">
        {leftIcon && (
          <div className="absolute inset-y-0 left-4 flex items-center text-zinc-500">
            {leftIcon}
          </div>
        )}

        <input
          className={clsx(
            "w-full rounded-2xl border border-zinc-800 bg-[#111113]",
            "text-white placeholder:text-zinc-500",
            "transition-all duration-200",
            "focus:border-zinc-600",
            "focus:outline-none",
            "focus:ring-2 focus:ring-white/10",

            leftIcon && "pl-11",
            rightIcon && "pr-11",

            sizes[size],

            error &&
              "border-red-500 focus:border-red-500 focus:ring-red-500/20",

            className
          )}
          {...props}
        />

        {rightIcon && (
          <div className="absolute inset-y-0 right-4 flex items-center text-zinc-500">
            {rightIcon}
          </div>
        )}
      </div>

      {error ? (
        <p className="text-sm text-red-400">
          {error}
        </p>
      ) : (
        hint && (
          <p className="text-sm text-zinc-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}