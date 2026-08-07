import {
    FileQuestion,
    FolderTree,
    Building2,
    Star,
} from "lucide-react";

export default function QuestionStats({

    questions = [],

    categories = [],

    divisions = [],

    favorites = 0,

}) {

    const stats = [

        {
            title: "Preguntas",
            value: questions.length,
            icon: FileQuestion,
        },

        {
            title: "Categorías",
            value: categories.length,
            icon: FolderTree,
        },

        {
            title: "Divisiones",
            value: divisions.length,
            icon: Building2,
        },

        {
            title: "Favoritas",
            value: favorites,
            icon: Star,
        },

    ];

    return (

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">

            {

                stats.map((item)=>{

                    const Icon=item.icon;

                    return(

                        <div

                            key={item.title}

                            className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6"

                        >

                            <div className="flex items-center justify-between">

                                <div>

                                    <p className="text-sm text-zinc-500">

                                        {item.title}

                                    </p>

                                    <h2 className="mt-3 text-4xl font-bold">

                                        {item.value}

                                    </h2>

                                </div>

                                <div className="rounded-xl bg-zinc-900 p-3">

                                    <Icon size={28}/>

                                </div>

                            </div>

                        </div>

                    );

                })

            }

        </div>

    );

}