export default function WeightSlider({

    value,

    onChange,

}){

    return(

        <div>

            <div className="mb-2 flex justify-between">

                <span className="text-sm text-zinc-400">

                    Peso

                </span>

                <span className="font-semibold">

                    {value}%

                </span>

            </div>

            <input

                type="range"

                min="0"

                max="100"

                value={value}

                onChange={(e)=>onChange(Number(e.target.value))}

                className="w-full"

            />

        </div>

    );

}