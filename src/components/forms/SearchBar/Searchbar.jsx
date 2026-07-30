import { Search, X } from "lucide-react";
import clsx from "clsx";

export default function SearchBar({
  value = "",
  onChange,
  onClear,
  placeholder = "Buscar...",
  className = "",
}) {
  const handleChange = (e) => {
    onChange?.(e.target.value);
  };

  const handleClear = () => {
    onClear?.();

    if (onChange) {
      onChange("");
    }
  };

  return (
    <div className={clsx("relative w-full", className)}>
      <Search
        size={18}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500"
      />

      <input
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="
          h-11
          w-full
          rounded-2xl
          border
          border-zinc-800
          bg-[#111113]
          pl-11
          pr-11
          text-sm
          text-white
          placeholder:text-zinc-500
          transition-all
          duration-200
          focus:border-zinc-600
          focus:outline-none
          focus:ring-2
          focus:ring-white/10
        "
      />

      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="
            absolute
            right-3
            top-1/2
            flex
            h-8
            w-8
            -translate-y-1/2
            items-center
            justify-center
            rounded-lg
            text-zinc-500
            transition-colors
            hover:bg-zinc-800
            hover:text-white
          "
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}