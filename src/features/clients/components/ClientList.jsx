import ClientCard from "./ClientCard";

export default function ClientList({
  clients,
}) {
  return (
    <div className="space-y-8">

      {clients.map((client) => (

        <ClientCard
          key={client.id}
          client={client}
        />

      ))}

    </div>
  );
}