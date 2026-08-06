import { useState } from "react";

import { CheckCircle } from "lucide-react";

import { useAuth } from "../../../Context/AuthContext";

import publish from "../engine/publish";

export default function StepPublish({

    form,

    onBack,

}) {

    const { profile, user } = useAuth();

    const [loading, setLoading] = useState(false);

    const [message, setMessage] = useState("");

    async function handlePublish() {

        try {

            setLoading(true);

            const result = await publish(

                form,

                profile,

                user

            );

            if (!result.success) {

                alert(result.errors.join("\n"));

                setLoading(false);

                return;

            }

            setMessage(

                "✅ Evaluación publicada correctamente."

            );

            setLoading(false);

        }

        catch (error) {

            console.error(error);

            alert(error.message);

            setLoading(false);

        }

    }

    return (

        <div className="mx-auto max-w-5xl">

            <h1 className="text-4xl font-bold text-white">

                Publicar evaluación

            </h1>

            <p className="mt-3 text-zinc-500">

                Todo está listo.

                ORVESEN guardará la evaluación,

                las categorías y las preguntas.

            </p>

            <div className="mt-10 rounded-3xl border border-zinc-800 bg-[#111113] p-8">

                <div className="flex items-center gap-3">

                    <CheckCircle

                        className="text-green-500"

                        size={24}

                    />

                    <div>

                        <h2 className="font-semibold text-white">

                            Evaluación lista

                        </h2>

                        <p className="text-zinc-500">

                            Nombre: {form.name}

                        </p>

                        <p className="text-zinc-500">

                            Categorías: {form.categories.length}

                        </p>

                    </div>

                </div>

            </div>

            {

                message &&

                <div className="mt-6 rounded-xl border border-green-800 bg-green-950/30 p-4 text-green-300">

                    {message}

                </div>

            }

            <div className="mt-12 flex justify-between">

                <button

                    onClick={onBack}

                    className="rounded-2xl border border-zinc-700 px-8 py-4"

                >

                    Atrás

                </button>

                <button

                    onClick={handlePublish}

                    disabled={loading}

                    className="rounded-2xl bg-white px-8 py-4 font-semibold text-black"

                >

                    {

                        loading

                            ? "Publicando..."

                            : "Publicar evaluación"

                    }

                </button>

            </div>

        </div>

    );

}
