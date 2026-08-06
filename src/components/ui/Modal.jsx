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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`
          flex
          w-full
          ${sizes[size]}
          max-h-[90vh]
          flex-col
          rounded-3xl
          border
          border-zinc-800
          bg-[#111113]
          shadow-2xl
          overflow-hidden
        `}
      >
        {/* Encabezado */}
        <header className="flex items-start justify-between border-b border-zinc-800 px-8 py-6 shrink-0">
          <div>
            <h2 className="text-2xl font-semibold text-white">
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
            className="rounded-xl p-2 transition hover:bg-zinc-800"
          >
            <X size={18} />
          </button>
        </header>

        {/* Contenido con scroll */}
        <div className="flex-1 overflow-y-auto p-8">
          {children}
        </div>

        {/* Footer opcional */}
        {footer && (
          <footer className="shrink-0 flex justify-end gap-3 border-t border-zinc-800 p-6">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}