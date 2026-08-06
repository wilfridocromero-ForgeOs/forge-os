export default function StepIndicator({

    current,

}) {

    const steps=[

        "Información",

        "Categorías",

        "Biblioteca",

        "Pesos",

        "Vista previa",

        "Publicar",

    ];

    return(

        <div className="mb-12">

            <div className="flex items-center justify-between">

                {

                    steps.map((item,index)=>(

                        <div

                            key={item}

                            className="flex flex-1 items-center"

                        >

                            <div

                                className={`

                                    flex

                                    h-11

                                    w-11

                                    items-center

                                    justify-center

                                    rounded-full

                                    border

                                    text-sm

                                    font-semibold

                                    transition

                                    ${

                                        current>index

                                        ?

                                        "border-white bg-white text-black"

                                        :

                                        current===index

                                        ?

                                        "border-white text-white"

                                        :

                                        "border-zinc-700 text-zinc-600"

                                    }

                                `}

                            >

                                {index+1}

                            </div>

                            {

                                index<steps.length-1 &&

                                <div

                                    className={`

                                        mx-3

                                        h-[2px]

                                        flex-1

                                        ${

                                            current>index

                                            ?

                                            "bg-white"

                                            :

                                            "bg-zinc-800"

                                        }

                                    `}

                                />

                            }

                        </div>

                    ))

                }

            </div>

            <div className="mt-5 flex justify-between text-xs text-zinc-500">

                {

                    steps.map(item=>(

                        <div

                            key={item}

                            className="w-24 text-center"

                        >

                            {item}

                        </div>

                    ))

                }

            </div>

        </div>

    );

}