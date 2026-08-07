import Card from "../components/Card";
import Button from "../components/Button";
import Input from "../components/Input";
import Textarea from "../components/Textarea";
import SectionTitle from "../components/SectionTitle";

const divisions = [
    "ORVESEN Digital",
    "ORVESEN Studio",
    "ORVESEN Media",
    "ORVESEN Academy",
    "ORVESEN OS",
    "General",
];

export default function StepInformation({

    form,

    setForm,

    onNext,

}) {

    function update(field, value) {

        setForm({

            ...form,

            [field]: value,

        });

    }

    function continueStep() {

        if (!form.name?.trim()) {

            alert("Escribe el nombre del Score.");

            return;

        }

        if (!form.division) {

            alert("Selecciona una división.");

            return;

        }

        onNext();

    }

    return (

        <div className="space-y-8">

            <SectionTitle

                title="Información general"

                subtitle="Define la información principal de la evaluación."

            />

            <Card>

                <div className="grid gap-6">

                    <div>

                        <label className="mb-2 block text-sm text-zinc-400">

                            Nombre

                        </label>

                        <Input

                            value={form.name}

                            placeholder="Ej: Auditoría SEO"

                            onChange={(e) =>
                                update("name", e.target.value)
                            }

                        />

                    </div>

                    <div>

                        <label className="mb-2 block text-sm text-zinc-400">

                            Descripción

                        </label>

                        <Textarea

                            rows={5}

                            value={form.description}

                            placeholder="Describe el propósito del Score..."

                            onChange={(e) =>
                                update("description", e.target.value)
                            }

                        />

                    </div>

                    <div>

                        <label className="mb-2 block text-sm text-zinc-400">

                            División

                        </label>

                        <select

                            value={form.division}

                            onChange={(e) =>
                                update("division", e.target.value)
                            }

                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3"

                        >

                            <option value="">

                                Selecciona una división

                            </option>

                            {divisions.map((division) => (

                                <option

                                    key={division}

                                    value={division}

                                >

                                    {division}

                                </option>

                            ))}

                        </select>

                    </div>

                    <div>

                        <label className="mb-2 block text-sm text-zinc-400">

                            Score Máximo

                        </label>

                        <Input

                            type="number"

                            value={form.scale}

                            onChange={(e) =>
                                update("scale", Number(e.target.value))
                            }

                        />

                    </div>

                </div>

            </Card>

            <div className="flex justify-end">

                <Button

                    onClick={continueStep}

                >

                    Continuar

                </Button>

            </div>

        </div>

    );

}