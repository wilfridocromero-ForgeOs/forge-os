export default function SectionTitle({
  title,
  subtitle,
}) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-bold text-zinc-950 dark:text-white">
        {title}
      </h1>

      {subtitle && (
        <p className="text-zinc-600 dark:text-zinc-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}