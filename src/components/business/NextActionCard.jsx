import { ArrowRight, Clock3 } from "lucide-react";

import Card from "../ui/Card";
import Button from "../actions/Button";

export default function NextActionCard({
  title,
  client,
  duration,
  description,
  onStart,
}) {
  return (
    <Card className="h-full">

      <div className="flex flex-col h-full">

        {/* Header */}

        <div>

          <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
            Próxima acción
          </p>

          <h2 className="mt-5 text-3xl font-semibold text-white">
            {title}
          </h2>

          <p className="mt-3 text-zinc-400 leading-7">
            {description}
          </p>

        </div>

        {/* Cliente */}

        <div className="mt-10">

          <p className="text-sm text-zinc-500">
            Cliente
          </p>

          <h3 className="mt-2 text-xl font-medium text-white">
            {client}
          </h3>

        </div>

        {/* Tiempo */}

        <div className="mt-8 flex items-center gap-3 text-zinc-500">

          <Clock3 size={18} />

          <span>
            {duration}
          </span>

        </div>

        <div className="flex-1" />

        {/* Botón */}

        <div className="mt-10">

          <Button
            onClick={onStart}
            className="w-full"
          >
            <div className="flex items-center justify-center gap-2">
              Comenzar
              <ArrowRight size={18} />
            </div>
          </Button>

        </div>

      </div>

    </Card>
  );
}