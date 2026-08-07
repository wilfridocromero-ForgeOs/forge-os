import StartChoice from "./components/StartChoice";
import StepIndicator from "./components/StepIndicator";

import StepInformation from "./steps/StepInformation";
import StepCategories from "./steps/StepCategories";
import StepQuestions from "./steps/StepQuestions";
import StepWeights from "./steps/StepWeights";
import StepPreview from "./steps/StepPreview";
import StepPublish from "./steps/StepPublish";

import useScoreBuilder from "./hooks/useScoreBuilder";

export default function Wizard({ library = [] }) {

    const {

        step,

        next,

        back,

        mode,

        setMode,

        form,

        setForm,

        addCategory,

        updateCategory,

        removeCategory,

        addQuestion,

        updateQuestion,

        removeQuestion,

    } = useScoreBuilder();

    return (

        <div className="mx-auto max-w-7xl">

            {step > 0 && (

                <StepIndicator current={step - 1} />

            )}

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
                    addCategory={addCategory}
                    updateCategory={updateCategory}
                    removeCategory={removeCategory}
                    onBack={back}
                    onNext={next}
                />

            )}

            {step === 3 && (

                <StepQuestions
                    library={library}
                    form={form}
                    setForm={setForm}
                    addQuestion={addQuestion}
                    updateQuestion={updateQuestion}
                    removeQuestion={removeQuestion}
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