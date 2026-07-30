import Card from "../../../components/ui/Card";

import { clients } from "../data/clients";

import ClientRow from "./ClientRow";

export default function ClientTable() {
  return (
    <Card className="overflow-hidden p-0">

      <table className="w-full">

        <thead className="border-b border-zinc-800 bg-zinc-950">

          <tr className="text-left text-xs uppercase tracking-[0.25em] text-zinc-500">

            <th className="px-6 py-5">Empresa</th>

            <th>Email</th>

            <th>Estado</th>

            <th>Discovery</th>

            <th>Score</th>

            <th>Actividad</th>

            <th></th>

          </tr>

        </thead>

        <tbody>

          {clients.map((client) => (
            <ClientRow
              key={client.id}
              client={client}
            />
          ))}

        </tbody>

      </table>

    </Card>
  );
}