import Button from "./Button";

export default function EmptyState({
  title,
  description,
  action,
  actionText,
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-800 py-20 text-center">

      <h2 className="text-2xl font-semibold text-white">
        {title}
      </h2>

      <p className="mt-4 max-w-md text-zinc-500">
        {description}
      </p>

      {action && (
        <div className="mt-8">
          <Button onClick={action}>
            {actionText}
          </Button>
        </div>
      )}

    </div>
  );
}