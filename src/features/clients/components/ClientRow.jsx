import ClientStatusBadge from "./ClientStatusBadge";
import ClientActions from "./ClientActions";

export default function ClientRow({ client }) {
  return (
    <tr className="border-b border-zinc-800">

      <td className="py-5">
        <div>
          <p className="font-medium text-white">
            {client.company}
          </p>

          <p className="text-sm text-zinc-500">
            {client.contact}
          </p>
        </div>
      </td>

      <td>{client.email}</td>

      <td>
        <ClientStatusBadge status={client.status} />
      </td>

      <td>{client.discovery}%</td>

      <td>{client.score}</td>

      <td>{client.lastActivity}</td>

      <td>
        <ClientActions />
      </td>

    </tr>
  );
}