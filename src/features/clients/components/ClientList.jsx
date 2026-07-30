import ClientCard from "./ClientCard";
import ClientEmptyState from "./ClientEmptyState";

export default function ClientList({
  clients,
  onEdit,
  onDelete,
}) {
  if (clients.length === 0) {
    return <ClientEmptyState />;
  }

  return (
    <div>
      {clients.map((client) => (
        <ClientCard
          key={client.id}
          client={client}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}