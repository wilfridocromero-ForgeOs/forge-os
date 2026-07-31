import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";

export default function PasswordInput({
  value,
  onChange,
  placeholder = "Contraseña",
  error = false,
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">

      <Lock
        size={18}
        className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-500"
      />

      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
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
          pr-14

          text-white

          placeholder:text-zinc-600

          outline-none

          transition-all
          duration-200
        `}
      />

      <button
        type="button"
        onClick={() => setShow(!show)}
        className="
          absolute
          right-5
          top-1/2
          -translate-y-1/2

          text-zinc-500

          hover:text-white

          transition-colors
        "
      >
        {show ? <EyeOff size={19} /> : <Eye size={19} />}
      </button>

    </div>
  );
}