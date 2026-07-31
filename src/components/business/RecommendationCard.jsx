import Card from "../ui/Card";
import { Sparkles } from "lucide-react";

export default function RecommendationsCard({
  recommendations = [],
}) {
  return (
    <Card>

      <div className="flex items-center gap-3">

        <Sparkles
          size={18}
          className="text-white"
        />

        <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
          ORVESEN IA
        </p>

      </div>

      <div className="mt-8 space-y-7">

        {recommendations.map((item, index) => (

          <div key={index}>

            <p className="font-semibold text-white">
              {item.title}
            </p>

            <p className="mt-2 leading-7 text-zinc-400">
              {item.description}
            </p>

          </div>

        ))}

      </div>

    </Card>
  );
}