export default function Button({

    children,

    variant = "primary",

    type = "button",

    className = "",

    ...props

}) {

    const styles = {

        primary:
            "bg-white text-black hover:bg-zinc-200",

        secondary:
            "border border-zinc-700 bg-zinc-900 text-white hover:bg-zinc-800",

        danger:
            "bg-red-600 text-white hover:bg-red-700",

    };

    return (

        <button
            type={type}
            className={`
                inline-flex
                items-center
                justify-center
                rounded-xl
                px-5
                py-3
                font-semibold
                transition
                ${styles[variant]}
                ${className}
            `}
            {...props}
        >

            {children}

        </button>

    );

}