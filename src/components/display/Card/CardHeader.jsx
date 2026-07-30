export default function CardHeader({
  title,
  subtitle,
  actions,
  className = "",
}) {
  return (
    <header
      className={`flex items-start justify-between gap-6 mb-8 ${className}`}
    >
      <div>
        {subtitle && (
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500 mb-3">
            {subtitle}
          </p>
        )}

        {title && (
          <h2 className="text-3xl font-semibold tracking-tight text-white">
            {title}
          </h2>
        )}
      </div>

      {actions}
    </header>
  );
}