import { Circle } from "lucide-react";

import Card from "../ui/Card";

export default function ActivityTimeline({ activities = [] }) {
  return (
    <Card className="h-full" contentClassName="p-5 sm:p-6">

      {/* Header */}

      <div>

        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          Actividad reciente
        </p>

        <h2 className="mt-2 text-xl font-semibold text-white">
          Últimos movimientos
        </h2>

      </div>

      {/* Timeline */}

      <div className="mt-5 space-y-5">

        {activities.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-800 p-5 text-sm text-zinc-500">
            Todavía no hay movimientos reales para mostrar.
          </p>
        )}

        {activities.map((activity, index) => (
          <div
            key={index}
            className="relative flex gap-5"
          >
            {/* Línea */}

            {index !== activities.length - 1 && (
              <div
                className="
                  absolute
                  left-[8px]
                  top-5
                  h-full
                  w-px
                  bg-zinc-800
                "
              />
            )}

            {/* Punto */}

            <Circle
              size={18}
              fill="currentColor"
              className="mt-1 shrink-0 text-white"
            />

            {/* Contenido */}

            <div className="flex-1">

              <p className="text-sm text-zinc-500">
                {activity.time}
              </p>

              <h3 className="mt-1 text-base font-medium text-white">
                {activity.title}
              </h3>

              <p className="mt-1 text-sm leading-6 text-zinc-500">
                {activity.description}
              </p>

            </div>

          </div>
        ))}

      </div>

    </Card>
  );
}
