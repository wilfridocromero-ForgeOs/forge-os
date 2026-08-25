import { Circle } from "lucide-react";
import { Link } from "react-router-dom";

import Card from "../ui/Card";

export default function ActivityTimeline({ activities = [], loading = false, unavailable = false }) {
  const recentActivities = activities.slice(0, 4);

  return (
    <Card className="h-full" contentClassName="p-5 sm:p-6">

      {/* Header */}

      <div>

        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          Actividad de proyectos
        </p>

        <h2 className="mt-2 text-xl font-semibold text-white">
          Movimientos recientes
        </h2>

      </div>

      {/* Timeline */}

      <div className="mt-5 space-y-5">

        {loading && <p className="rounded-xl border border-zinc-800 p-5 text-sm text-zinc-500">Cargando actividad…</p>}
        {!loading && unavailable && <p className="rounded-xl border border-amber-900/50 p-5 text-sm text-amber-300">La actividad de proyectos no está disponible ahora.</p>}
        {!loading && !unavailable && activities.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-800 p-5 text-sm text-zinc-500">
            Todavía no hay movimientos reales para mostrar.
          </p>
        )}

        {recentActivities.map((activity, index) => (
          <div
            key={index}
            className="relative flex gap-5"
          >
            {/* Línea */}

            {index !== recentActivities.length - 1 && (
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

            <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">

              <p className="text-sm text-zinc-500">
                {activity.time}
              </p>

              <h3 className="mt-1 text-base font-medium text-white">
                {activity.title}
              </h3>

              <p className="mt-1 text-sm leading-6 text-zinc-500">
                {activity.description}
              </p>
              {activity.projectId && <Link to={`/proyectos/${activity.projectId}`} className="mt-2 inline-flex min-h-9 items-center text-xs font-medium text-zinc-300 underline underline-offset-4">Abrir proyecto</Link>}

            </div>

          </div>
        ))}

      </div>

    </Card>
  );
}
