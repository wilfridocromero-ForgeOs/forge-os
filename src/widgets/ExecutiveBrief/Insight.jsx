import { ArrowUpRight } from "lucide-react";

export default function Insight({ text }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-zinc-800 p-4">

      <ArrowUpRight
        size={16}
        className="text-green-400"
      />

      <p className="text-zinc-300">
        {text}
      </p>

    </div>
  );
}