import { CircularProgressbar, buildStyles } from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";

import { dashboardData } from "../data/dashboard";

import Card from "./ui/Card";
import Button from "./ui/Button";

export default function OrvesenScore() {
  const score = dashboardData.score;

  return (
    <Card className="p-10">
      <p className="text-xs uppercase tracking-[0.35em] text-zinc-500">
        ORVESEN SCORE
      </p>

      <div className="mt-10 flex flex-col items-center">
        <div className="h-52 w-52">
          <CircularProgressbar
            value={(score.total / score.max) * 100}
            maxValue={100}
            text={`${score.total}`}
            strokeWidth={7}
            styles={buildStyles({
              pathColor: "#ffffff",
              trailColor: "#27272a",
              textColor: "#ffffff",
              textSize: "18px",
            })}
          />
        </div>

        <span className="mt-4 text-base text-zinc-500">
          de {score.max}
        </span>

        <h2 className="mt-8 text-center text-4xl font-semibold text-white">
          {score.status}
        </h2>

        <p className="mt-5 max-w-md text-center leading-8 text-zinc-400">
          {score.description}
        </p>
      </div>

      <div className="mt-12 flex items-center justify-between border-t border-zinc-800 pt-8">
        <span className="text-sm font-medium text-emerald-400">
          ▲ +{score.improvement} puntos este mes
        </span>

        <Button variant="secondary">
          Ver diagnóstico →
        </Button>
      </div>
    </Card>
  );
}