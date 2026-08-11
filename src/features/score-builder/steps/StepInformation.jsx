import { useEffect, useState } from "react";

import Card from "../components/Card";
import Button from "../components/Button";
import Input from "../components/Input";
import Textarea from "../components/Textarea";
import SectionTitle from "../components/SectionTitle";

import { supabase } from "../../../lib/supabase";
import { useOrganization } from "../../../Context/OrganizationContext";

export default function StepInformation({
    form,
    setForm,
    onNext,
}) {
    const { organization, loading: organizationLoading } =
        useOrganization();

    const [divisions, setDivisions] = useState([]);
    const [loadingDivisions, setLoadingDivisions] = useState(true);
    const [divisionError, setDivisionError] = useState("");

    useEffect(() => {
        async function loadDivisions() {
            if (organizationLoading) {
                return;
            }

            if (!organization?.id) {
                setDivisions([]);
                setDivisionError(
                    "No se encontró una organización activa."
                );
                setLoadingDivisions(false);
                return;
            }

            setLoadingDivisions(true);
            setDivisionError("");

            const { data, error } = await supabase
                .from("divisions")
                .select("id, name, slug, position")
                .eq("organization_id", organization.id)
                .eq("active", true)
                .order("position", { ascending: true })
                .order("name", { ascending: true });

            if (error) {
                console.error(
                    "Error loading divisions:",
                    error
                );

                setDivisions([]);
                setDivisionError(
                    "No se pudieron cargar las divisiones."
                );
                setLoadingDivisions(false);
                return;
            }

            setDivisions(data || []);
            setLoadingDivisions(false);
        }

        loadDivisions();
    }, [organization?.id, organizationLoading]);

    function update(field, value) {
        setForm((current) => ({
            ...current,
            [field]: value,
        }));
    }

    function handleDivisionChange(event) {
        const divisionId = event.target.value;

        const selectedDivision = divisions.find(
            (division) => division.id === divisionId
        );

        setForm((current) => ({
            ...current,
            division_id: divisionId,
            division_name: selectedDivision?.name || "",
        }));
    }

    function continueStep() {
        if (!form.name?.trim()) {
            alert("Escribe el nombre del Score.");
            return;
        }

        if (!form.division_id) {
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
                            placeholder="Ej: ORVESEN Digital Score"
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
                                update(
                                    "description",
                                    e.target.value
                                )
                            }
                        />
                    </div>

                    <div>
                        <label className="mb-2 block text-sm text-zinc-400">
                            División
                        </label>

                        <select
                            value={form.division_id || ""}
                            onChange={handleDivisionChange}
                            disabled={
                                loadingDivisions ||
                                organizationLoading
                            }
                            className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <option value="">
                                {loadingDivisions ||
                                organizationLoading
                                    ? "Cargando divisiones..."
                                    : "Selecciona una división"}
                            </option>

                            {divisions.map((division) => (
                                <option
                                    key={division.id}
                                    value={division.id}
                                >
                                    {division.name}
                                </option>
                            ))}
                        </select>

                        {divisionError && (
                            <p className="mt-2 text-sm text-red-400">
                                {divisionError}
                            </p>
                        )}

                        {!loadingDivisions &&
                            !divisionError &&
                            divisions.length === 0 && (
                                <p className="mt-2 text-sm text-amber-400">
                                    Esta organización todavía no tiene
                                    divisiones activas.
                                </p>
                            )}
                    </div>

                    <div>
                        <label className="mb-2 block text-sm text-zinc-400">
                            Score Máximo
                        </label>

                        <Input
                            type="number"
                            value={form.scale}
                            disabled
                        />

                        <p className="mt-2 text-xs text-zinc-500">
                            Los Scores de ORVESEN utilizan una escala
                            estándar de 1,000 puntos.
                        </p>
                    </div>

                </div>
            </Card>

            <div className="flex justify-end">
                <Button
                    onClick={continueStep}
                    disabled={
                        loadingDivisions ||
                        organizationLoading ||
                        divisions.length === 0
                    }
                >
                    Continuar
                </Button>
            </div>
        </div>
    );
}