import { ArrowRight, Sparkles } from "lucide-react";

import Card from "../ui/Card";
import Button from "../actions/Button";

export default function ActionPlanCard({
  title,
  impact,
  time,
  description,
}) {
  return (
    <Card className="h-full">

      <div className="flex items-center gap-3">

        <Sparkles
          size={18}
          className="text-white"
        />

        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          PLAN DE ACCIÓN
        </p>

      </div>

      <div className="mt-8">

        <h2 className="text-3xl font-semibold text-white">
          {title}
        </h2>

        <p className="mt-4 leading-7 text-zinc-400">
          {description}
        </p>

      </div>

      <div className="mt-10 grid grid-cols-2 gap-6">

        <div>

          <p className="text-xs uppercase tracking-[0.30em] text-zinc-500">
            Impacto
          </p>

          <h3 className="mt-2 text-2xl font-semibold text-white">
            +{impact}
          </h3>

        </div>

        <div>

          <p className="text-xs uppercase tracking-[0.30em] text-zinc-500">
            Tiempo
          </p>

          <h3 className="mt-2 text-2xl font-semibold text-white">
            {time}
          </h3>

        </div>

      </div>

      <div className="mt-10">

        <Button className="w-full">

          <div className="flex items-center justify-center gap-2">

            Comenzar ahora

            <ArrowRight size={18} />

          </div>

        </Button>

      </div>

    </Card>
  );
}