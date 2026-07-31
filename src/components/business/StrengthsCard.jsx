import Card from "../ui/Card";
import { CheckCircle2 } from "lucide-react";

export default function StrengthsCard({
  strengths = [],
}) {
  return (
    <Card>

      <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
        FORTALEZAS
      </p>

      <div className="mt-8 space-y-5">

        {strengths.map((item) => (

          <div
            key={item}
            className="flex items-start gap-4"
          >

            <CheckCircle2
              size={20}
              className="mt-1 text-green-400"
            />

            <p className="leading-7 text-zinc-300">
              {item}
            </p>

          </div>

        ))}

      </div>

    </Card>
  );
}