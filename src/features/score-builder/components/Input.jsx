export default function Input({

    className = "",

    ...props

}) {

    return (

        <input

            className={`
                w-full
                rounded-xl
                border
                border-zinc-800
                bg-zinc-950
                px-4
                py-3
                text-white
                outline-none
                focus:border-white
                ${className}
            `}

            {...props}

        />

    );

}