/*
|--------------------------------------------------------------------------
| ORVESEN SCORE ENGINE
|--------------------------------------------------------------------------
|
| Este archivo calcula el Score de cualquier evaluación.
|
| NO guarda datos.
| NO usa Supabase.
| Solo recibe respuestas y devuelve resultados.
|
*/

export function calculateScore(categories = []) {

    let totalScore = 0;

    let totalWeight = 0;

    const details = [];

    categories.forEach(category => {

        let categoryResult = 0;

        let categoryWeight = Number(category.weight || 0);

        let questionWeight = 0;

        category.questions.forEach(question => {

            const weight = Number(question.weight || 0);

            questionWeight += weight;

            categoryResult += normalize(question) * weight;

        });

        if (questionWeight > 0) {

            categoryResult = categoryResult / questionWeight;

        }

        details.push({

            category: category.name,

            score: categoryResult,

            weight: categoryWeight,

        });

        totalScore += categoryResult * categoryWeight;

        totalWeight += categoryWeight;

    });

    if (totalWeight > 0) {

        totalScore = totalScore / totalWeight;

    }

    return {

        score: Number(totalScore.toFixed(2)),

        percentage: Number((totalScore / 1000 * 100).toFixed(2)),

        details,

    };

}

/*
|--------------------------------------------------------------------------
| Convierte cualquier respuesta a una escala de 0-1000
|--------------------------------------------------------------------------
*/

function normalize(question){

    const value = question.answer;

    switch(question.response_type){

        case "scale":

            return ((Number(value)-1)/4)*1000;

        case "yes_no":

            return value ? 1000 : 0;

        case "number":

            return Number(value || 0);

        case "percentage":

            return Number(value || 0) * 10;

        case "multiple_choice":

            return Number(value || 0);

        case "text":

            return 1000;

        default:

            return 0;

    }

}

/*
|--------------------------------------------------------------------------
| Calcula el porcentaje de progreso
|--------------------------------------------------------------------------
*/

export function calculateProgress(categories=[]){

    let questions=0;

    let answered=0;

    categories.forEach(category=>{

        category.questions.forEach(question=>{

            questions++;

            if(
                question.answer!==undefined &&
                question.answer!==null &&
                question.answer!==""
            ){

                answered++;

            }

        });

    });

    if(!questions){

        return 0;

    }

    return Math.round(answered/questions*100);

}

/*
|--------------------------------------------------------------------------
| Obtiene el color del Score
|--------------------------------------------------------------------------
*/

export function scoreColor(score){

    if(score>=900){

        return "emerald";

    }

    if(score>=750){

        return "green";

    }

    if(score>=600){

        return "yellow";

    }

    if(score>=400){

        return "orange";

    }

    return "red";

}

/*
|--------------------------------------------------------------------------
| Convierte Score a Nivel
|--------------------------------------------------------------------------
*/

export function scoreLevel(score){

    if(score>=900){

        return "Excelente";

    }

    if(score>=750){

        return "Bueno";

    }

    if(score>=600){

        return "Aceptable";

    }

    if(score>=400){

        return "Débil";

    }

    return "Crítico";

}