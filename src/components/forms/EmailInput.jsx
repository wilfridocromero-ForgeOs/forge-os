import { Mail } from "lucide-react";

export default function EmailInput({
  value,
  onChange,
  placeholder = "Correo electrónico",
  error = false,
}) {
  return (
    <div className="relative">

      <Mail
        size={18}
        className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500"
      />

      <input
        type="email"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete="email"
        className={`
          w-full

          rounded-2xl

          border
          ${
            error
              ? "border-red-500"
              : "border-zinc-800 focus:border-zinc-600"
          }

          bg-zinc-950

          py-4
          pl-14
          pr-5

          text-white

          placeholder:text-zinc-600

          outline-none

          transition-all
          duration-200
        `}
      />

    </div>
  );
}