export default function StepHeader({

    title,

    subtitle,

}){

    return(

        <div className="mb-8">

            <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">

                ORVESEN Score Builder

            </p>

            <h1 className="mt-2 text-4xl font-bold text-white">

                {title}

            </h1>

            <p className="mt-3 max-w-3xl text-zinc-400">

                {subtitle}

            </p>

        </div>

    );

}