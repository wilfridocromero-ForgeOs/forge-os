import Card from "./Card";

export default function BaseWidget({
  title,
  subtitle,
  action,
  children,
  className = "",
}) {
  return (
    <div className={className}>

      <Card>

        <div className="flex items-start justify-between">

          <div>

            <h2 className="text-xl font-semibold">
              {title}
            </h2>

            {subtitle && (
              <p className="mt-2 text-zinc-500">
                {subtitle}
              </p>
            )}

          </div>

          {action}

        </div>

        <div className="mt-8">

          {children}

        </div>

      </Card>

    </div>
  );
}