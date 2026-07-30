import { CircularProgressbar, buildStyles } from "react-circular-progressbar";
import "react-circular-progressbar/dist/styles.css";

import { dashboardData } from "../data/dashboard";

import Card from "./ui/Card";
import Button from "./ui/Button";

export default function OrvesenScore() {
  const score = dashboardData.score;

  return (
    <Card
      className="
        flex
        h-full
        min-h-[650px]
        flex-col

        p-6
        sm:p-8
        lg:p-10
      "
    >
      {/* Header */}

      <p
        className="
          text-xs
          font-medium
          uppercase
          tracking-[0.35em]
          text-zinc-500
        "
      >
        ORVESEN SCORE
      </p>

      {/* Contenido */}

      <div
        className="
          flex
          flex-1
          flex-col
          items-center
          justify-center
        "
      >
        {/* Ring */}

        <div
          className="
            w-full
            max-w-[240px]

            sm:max-w-[270px]

            lg:max-w-[310px]

            aspect-square
          "
        >
          <CircularProgressbar
            value={(score.total / score.max) * 100}
            maxValue={100}
            text={`${score.total}`}
            strokeWidth={7}
            styles={buildStyles({
              pathColor: "#ffffff",
              trailColor: "#27272a",
              textColor: "#ffffff",
              textSize: "22px",
            })}
          />
        </div>

        <p
          className="
            mt-6

            text-center
            text-sm
            tracking-wide

            text-zinc-500
          "
        >
          de <span className="text-zinc-300">{score.max}</span> puntos
        </p>

        <h2
          className="
            mt-8

            text-center

            text-3xl
            sm:text-4xl

            font-semibold

            text-white
          "
        >
          {score.status}
        </h2>

        <p
          className="
            mt-5

            max-w-xl

            text-center

            text-sm
            sm:text-base

            leading-7
            sm:leading-8

            text-zinc-400
          "
        >
          {score.description}
        </p>

      </div>

      {/* Footer */}

      <div
        className="
          mt-10

          flex
          flex-col
          gap-5

          border-t
          border-zinc-800

          pt-6

          sm:flex-row
          sm:items-center
          sm:justify-between
        "
      >
        <span
          className="
            text-center
            sm:text-left

            text-sm
            font-medium

            text-emerald-400
          "
        >
          ▲ +{score.improvement} puntos este mes
        </span>

        <Button
          variant="secondary"
          className="w-full sm:w-auto"
        >
          Ver diagnóstico
        </Button>

      </div>

    </Card>
  );
}