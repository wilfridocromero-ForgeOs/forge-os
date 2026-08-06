export default function StepHeader({

    step,
    totalSteps,
    title,
    description,

}) {

    return (

        <div className="mb-12">

            <span className="text-xs uppercase tracking-[0.35em] text-zinc-500">

                Paso {step} de {totalSteps}

            </span>

            <h1 className="mt-3 text-4xl font-bold text-white">

                {title}

            </h1>

            <p className="mt-3 max-w-3xl text-zinc-500 leading-7">

                {description}

            </p>

        </div>

    );

}