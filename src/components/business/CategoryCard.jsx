import Card from "../ui/Card";

export default function CategoryCard({
  title,
  score,
  description,
}) {
  const percentage = Math.min((score / 100) * 100, 100);

  return (
    <Card className="h-full">

      <div className="flex flex-col h-full">

        {/* Título */}

        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          {title}
        </p>

        {/* Score */}

        <div className="mt-6 flex items-end gap-3">

          <h2 className="text-5xl font-semibold text-white">
            {score}
          </h2>

          <span className="pb-2 text-zinc-500">
            /100
          </span>

        </div>

        {/* Barra */}

        <div className="mt-8 h-2 overflow-hidden rounded-full bg-zinc-800">

          <div
            className="
              h-full
              rounded-full
              bg-white
              transition-all
              duration-700
            "
            style={{
              width: `${percentage}%`,
            }}
          />

        </div>

        {/* Estado */}

        <p className="mt-8 leading-7 text-zinc-400">
          {description}
        </p>

      </div>

    </Card>
  );
}