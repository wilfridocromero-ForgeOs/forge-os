import QuestionCard from "../components/QuestionCard";

export default function QuestionList({

    questions,

    selectedQuestion,

    onSelect,

}){

    return(

        <div className="flex-1 overflow-y-auto p-5">

            <div className="space-y-4">

                {

                    questions.map((question)=>(

                        <QuestionCard

                            key={question.id}

                            question={question}

                            active={selectedQuestion?.id===question.id}

                            onClick={()=>onSelect(question)}

                        />

                    ))

                }

            </div>

        </div>

    );

}