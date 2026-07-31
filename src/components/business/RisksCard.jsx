import Card from "../ui/Card";
import { TriangleAlert } from "lucide-react";

export default function RisksCard({
  risks = [],
}) {
  return (
    <Card>

      <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
        RIESGOS
      </p>

      <div className="mt-8 space-y-5">

        {risks.map((item) => (

          <div
            key={item}
            className="flex items-start gap-4"
          >

            <TriangleAlert
              size={20}
              className="mt-1 text-yellow-400"
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