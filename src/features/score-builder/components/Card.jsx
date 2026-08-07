export default function Card({

    children,

    className = "",

}) {

    return (

        <div
            className={`
                rounded-2xl
                border
                border-zinc-800
                bg-zinc-950
                p-6
                shadow-sm
                ${className}
            `}
        >

            {children}

        </div>

    );

}