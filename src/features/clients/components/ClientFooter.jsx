import Button from "../../../components/ui/Button";

export default function ClientFooter({
  recommendation,
}) {
  return (
    <div
      className="
        mt-10

        border-t
        border-zinc-800

        pt-8

        flex
        items-end
        justify-between

        gap-8
      "
    >
      <div>

        <p
          className="
            text-xs

            uppercase

            tracking-[0.35em]

            text-zinc-500
          "
        >
          ORVESEN IA
        </p>

        <p className="mt-4 max-w-md leading-7 text-zinc-300">
          {recommendation}
        </p>

      </div>

      <Button className="w-auto px-8">
        Abrir Cliente
      </Button>
    </div>
  );
}