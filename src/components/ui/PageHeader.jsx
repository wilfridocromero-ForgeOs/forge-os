export default function PageHeader({
  eyebrow,
  title,
  description,
  children,
}) {
  return (
    <div className="flex items-end justify-between">

      <div className="max-w-3xl">

        {eyebrow && (
          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            {eyebrow}
          </p>
        )}

        <h1 className="mt-4 text-5xl font-semibold tracking-tight text-white">
          {title}
        </h1>

        {description && (
          <p className="mt-5 text-lg leading-8 text-zinc-400">
            {description}
          </p>
        )}

      </div>

      {children}

    </div>
  );
}