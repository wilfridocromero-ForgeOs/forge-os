export default function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">

      <div>

        {eyebrow && (
          <p
            className="
              text-xs
              uppercase
              tracking-[0.35em]
              text-zinc-500
            "
          >
            {eyebrow}
          </p>
        )}

        {title && (
          <h2
            className="
              mt-3
              text-3xl
              font-semibold
              tracking-tight
              text-white
            "
          >
            {title}
          </h2>
        )}

        {description && (
          <p
            className="
              mt-3
              max-w-2xl
              text-zinc-500
              leading-7
            "
          >
            {description}
          </p>
        )}

      </div>

      {actions && (
        <div>
          {actions}
        </div>
      )}

    </div>
  );
}