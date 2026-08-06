import { useState } from "react";

import StartChoice from "./components/StartChoice";
import StepIndicator from "./components/StepIndicator.jsx";
import StepInformation from "./steps/StepInformation";
import StepCategories from "./steps/StepCategories";
import StepImportQuestion from "./steps/StepImportQuestion";
import StepWeights from "./steps/StepWeights";
import StepPreview from "./steps/StepPreview";
import StepPublish from "./steps/StepPublish";

const initialForm = {
    name: "",
    description: "",
    division: "",
    scale: 1000,

    categories: [],

    settings: {
        passingScore: 80,
        autoPublish: false,
    }
};

export default function Wizard({ library = [] }) {

    const [step, setStep] = useState(0);

    const [mode, setMode] = useState("");

    const [form, setForm] = useState(initialForm);

    function next() {
        setStep((s) => s + 1);
    }

    function back() {
        setStep((s) => s - 1);
    }

    return (

        <div className="mx-auto max-w-7xl">

            {step > 0 && <StepIndicator current={step - 1} />}

            {step === 0 && (
                <StartChoice
                    selected={mode}
                    onSelect={setMode}
                    onContinue={next}
                />
            )}

            {step === 1 && (
                <StepInformation
                    form={form}
                    setForm={setForm}
                    onNext={next}
                />
            )}

            {step === 2 && (
                <StepCategories
                    form={form}
                    setForm={setForm}
                    onBack={back}
                    onNext={next}
                />
            )}

            {step === 3 && (
                <StepImportQuestion
                    library={library}
                    form={form}
                    setForm={setForm}
                    onBack={back}
                    onNext={next}
                />
            )}

            {step === 4 && (
                <StepWeights
                    form={form}
                    setForm={setForm}
                    onBack={back}
                    onNext={next}
                />
            )}

            {step === 5 && (
                <StepPreview
                    form={form}
                    onBack={back}
                    onNext={next}
                />
            )}

            {step === 6 && (
                <StepPublish
                    form={form}
                    mode={mode}
                    onBack={back}
                />
            )}

        </div>

    );

}