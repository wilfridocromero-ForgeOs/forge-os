export default function Input({
  label,
  hint,
  error,

  leftIcon: LeftIcon,
  rightIcon: RightIcon,

  size = "md",

  disabled = false,

  required = false,

  className = "",

  ...props
}) {
  const sizes = {
    sm: "px-4 py-3 text-sm",

    md: "px-5 py-4 text-base",

    lg: "px-6 py-5 text-lg",
  };

  return (
    <div className="space-y-3">

      {/* Label */}

      {label && (
        <label
          className="
            block

            text-sm
            font-medium

            text-zinc-300
          "
        >
          {label}

          {required && (
            <span className="ml-1 text-red-400">
              *
            </span>
          )}

        </label>
      )}

      {/* Input */}

      <div
        className="
          group

          relative

          flex
          items-center

          rounded-2xl

          border
          border-zinc-800

          bg-[#111113]

          transition-all
          duration-300

          focus-within:border-zinc-600

          focus-within:ring-4
          focus-within:ring-white/5
        "
      >

        {/* Left Icon */}

        {LeftIcon && (
          <LeftIcon
            size={18}
            className="ml-5 text-zinc-500"
          />
        )}

        <input
          disabled={disabled}
          className={`
            w-full

            bg-transparent

            text-white

            placeholder:text-zinc-500

            outline-none

            ${LeftIcon ? "pl-3" : ""}

            ${RightIcon ? "pr-3" : ""}

            ${sizes[size]}

            disabled:cursor-not-allowed
            disabled:opacity-50

            ${className}
          `}
          {...props}
        />

        {/* Right Icon */}

        {RightIcon && (
          <RightIcon
            size={18}
            className="mr-5 text-zinc-500"
          />
        )}

      </div>

      {/* Hint */}

      {!error && hint && (
        <p className="text-sm text-zinc-500">
          {hint}
        </p>
      )}

      {/* Error */}

      {error && (
        <p className="text-sm text-red-400">
          {error}
        </p>
      )}

    </div>
  );
}