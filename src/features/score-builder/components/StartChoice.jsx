import { FilePlus2, Library, Copy } from "lucide-react";

const options = [
  {
    id: "scratch",
    icon: FilePlus2,
    title: "Crear desde cero",
    description:
      "Construye una evaluación completamente nueva para cualquier división.",
  },
  {
    id: "official",
    icon: Library,
    title: "Usar Biblioteca Oficial",
    description:
      "Comienza con las categorías y preguntas oficiales de ORVESEN.",
  },
  {
    id: "duplicate",
    icon: Copy,
    title: "Duplicar un Score",
    description:
      "Copia una evaluación existente y personalízala.",
  },
];

export default function StartChoice({
  selected,
  onSelect,
  onContinue,
}) {
  return (
    <div className="mx-auto max-w-6xl">

      <div className="mb-12 text-center">

        <h1 className="text-5xl font-bold text-white">
          Nuevo Score
        </h1>

        <p className="mt-4 text-lg text-zinc-500">
          ¿Cómo deseas comenzar?
        </p>

      </div>

      <div className="grid gap-6 lg:grid-cols-3">

        {options.map((option) => {

          const Icon = option.icon;

          const active = selected === option.id;

          return (

            <button
              key={option.id}
              onClick={() => onSelect(option.id)}
              className={`
                rounded-3xl
                border
                p-8
                text-left
                transition-all
                duration-300

                ${
                  active
                    ? "border-white bg-white text-black shadow-2xl"
                    : "border-zinc-800 bg-[#111113] text-white hover:border-zinc-600 hover:-translate-y-1"
                }
              `}
            >

              <div
                className={`
                  flex
                  h-16
                  w-16
                  items-center
                  justify-center
                  rounded-2xl

                  ${
                    active
                      ? "bg-black text-white"
                      : "bg-zinc-900"
                  }
                `}
              >

                <Icon size={30} />

              </div>

              <h2 className="mt-8 text-2xl font-semibold">

                {option.title}

              </h2>

              <p
                className={`
                  mt-4
                  leading-7

                  ${
                    active
                      ? "text-black/70"
                      : "text-zinc-500"
                  }
                `}
              >

                {option.description}

              </p>

            </button>

          );

        })}

      </div>

      <div className="mt-14 flex justify-center">

        <button
          disabled={!selected}
          onClick={onContinue}
          className="
            rounded-2xl
            bg-white
            px-10
            py-4
            text-lg
            font-semibold
            text-black
            transition
            hover:scale-105
            disabled:opacity-40
            disabled:hover:scale-100
          "
        >

          Continuar

        </button>

      </div>

    </div>
  );
}