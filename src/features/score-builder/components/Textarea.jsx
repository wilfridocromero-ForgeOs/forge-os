export default function Textarea({
  className = "",
  ...props
}) {
  return (
    <textarea
      className={`
        w-full
        rounded-xl
        border
        border-zinc-300
        bg-white
        px-4
        py-3
        text-zinc-950
        outline-none
        resize-none
        transition-colors
        placeholder:text-zinc-400
        focus:border-zinc-500

        dark:border-zinc-800
        dark:bg-zinc-950
        dark:text-white
        dark:placeholder:text-zinc-600
        dark:focus:border-white

        disabled:cursor-not-allowed
        disabled:opacity-50

        ${className}
      `}
      {...props}
    />
  );
}