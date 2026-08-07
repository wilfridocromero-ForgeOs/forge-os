export default function Textarea({

    className = "",

    ...props

}) {

    return (

        <textarea

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
                resize-none
                focus:border-white
                ${className}
            `}

            {...props}

        />

    );

}