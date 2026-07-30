import { X } from "lucide-react";

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  children,
  footer,
}) {
  if (!open) return null;

  const sizes = {
    sm: "max-w-md",
    md: "max-w-2xl",
    lg: "max-w-4xl",
    xl: "max-w-6xl",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`
          w-full
          ${sizes[size]}
          rounded-3xl
          border
          border-zinc-800
          bg-[#111113]
          shadow-2xl
          overflow-hidden
        `}
      >
        <header className="flex items-start justify-between border-b border-zinc-800 px-8 py-6">

          <div>

            <h2 className="text-2xl font-semibold">
              {title}
            </h2>

            {subtitle && (
              <p className="mt-2 text-zinc-500">
                {subtitle}
              </p>
            )}

          </div>

          <button
            onClick={onClose}
            className="
              rounded-xl
              p-2
              hover:bg-zinc-800
              transition
            "
          >
            <X size={18} />
          </button>

        </header>

        <div className="p-8">

          {children}

        </div>

        {footer && (

          <footer className="flex justify-end gap-3 border-t border-zinc-800 p-6">

            {footer}

          </footer>

        )}

      </div>

    </div>
  );
}