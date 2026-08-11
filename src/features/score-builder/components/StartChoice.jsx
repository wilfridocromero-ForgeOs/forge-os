import {
  FilePlus2,
  Library,
  Copy,
} from "lucide-react";


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
    <div className="mx-auto w-full max-w-6xl">

      {/* HEADER */}

      <div className="mb-8 text-center sm:mb-12">

        <h1 className="text-3xl font-bold text-white sm:text-4xl lg:text-5xl">
          Nuevo Score
        </h1>

        <p className="mt-3 text-sm text-zinc-500 sm:mt-4 sm:text-base lg:text-lg">
          ¿Cómo deseas comenzar?
        </p>

      </div>


      {/* OPCIONES */}

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-3 lg:gap-6">

        {options.map((option) => {

          const Icon =
            option.icon;

          const active =
            selected === option.id;

          return (

            <button
              key={option.id}
              type="button"
              onClick={() =>
                onSelect(
                  option.id
                )
              }
              className={`
                w-full
                rounded-2xl
                border
                p-5
                text-left
                transition-all
                duration-300
                sm:rounded-3xl
                sm:p-6
                lg:p-8

                ${
                  active
                    ? "border-white bg-white text-black shadow-2xl"
                    : "border-zinc-800 bg-[#111113] text-white hover:border-zinc-600 lg:hover:-translate-y-1"
                }
              `}
            >

              {/* ICONO */}

              <div
                className={`
                  flex
                  h-12
                  w-12
                  items-center
                  justify-center
                  rounded-xl
                  sm:h-14
                  sm:w-14
                  sm:rounded-2xl
                  lg:h-16
                  lg:w-16

                  ${
                    active
                      ? "bg-black text-white"
                      : "bg-zinc-900"
                  }
                `}
              >

                <Icon
                  size={26}
                  className="sm:h-[28px] sm:w-[28px] lg:h-[30px] lg:w-[30px]"
                />

              </div>


              {/* TEXTO */}

              <h2 className="mt-5 text-xl font-semibold sm:mt-6 sm:text-2xl lg:mt-8">

                {option.title}

              </h2>


              <p
                className={`
                  mt-3
                  text-sm
                  leading-6
                  sm:mt-4
                  sm:text-base
                  sm:leading-7

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


      {/* CONTINUAR */}

      <div className="mt-8 flex justify-center sm:mt-10 lg:mt-14">

        <button
          type="button"
          disabled={!selected}
          onClick={onContinue}
          className="
            w-full
            rounded-xl
            bg-white
            px-6
            py-3.5
            text-base
            font-semibold
            text-black
            transition
            hover:bg-zinc-200
            disabled:cursor-not-allowed
            disabled:opacity-40
            sm:w-auto
            sm:rounded-2xl
            sm:px-10
            sm:py-4
            sm:text-lg
          "
        >

          Continuar

        </button>

      </div>

    </div>
  );
}