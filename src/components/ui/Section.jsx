export default function Section({
  eyebrow,
  title,
  description,
  children,
  className = "",
}) {
  return (
    <section className={`space-y-6 ${className}`}>
      {(eyebrow || title || description) && (
        <div>
          {eyebrow && (
            <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
              {eyebrow}
            </p>
          )}

          {title && (
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
              {title}
            </h2>
          )}

          {description && (
            <p className="mt-3 max-w-3xl text-zinc-400">
              {description}
            </p>
          )}
        </div>
      )}

      {children}
    </section>
  );
}