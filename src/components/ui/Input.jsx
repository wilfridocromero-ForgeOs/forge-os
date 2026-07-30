export default function Input({
  label,
  error,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  className = "",
  ...props
}) {
  return (
    <div className="w-full">

      {label && (
        <label className="mb-2 block text-sm font-medium text-zinc-300">
          {label}
        </label>
      )}

      <div className="relative">

        {LeftIcon && (
          <LeftIcon
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500"
          />
        )}

        <input
          className={`
            h-12
            w-full
            rounded-xl
            border
            border-zinc-800
            bg-[#111113]
            px-4
            text-white
            outline-none
            transition-all
            duration-200
            placeholder:text-zinc-600
            focus:border-zinc-600
            focus:ring-2
            focus:ring-white/10
            ${LeftIcon ? "pl-11" : ""}
            ${RightIcon ? "pr-11" : ""}
            ${className}
          `}
          {...props}
        />

        {RightIcon && (
          <RightIcon
            size={18}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500"
          />
        )}

      </div>

      {error && (
        <p className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}

    </div>
  );
}