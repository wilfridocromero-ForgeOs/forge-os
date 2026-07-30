export default function ClientStatusBadge({ status }) {
  const colors = {
    active: "bg-emerald-500/15 text-emerald-400",
    pending: "bg-amber-500/15 text-amber-400",
    inactive: "bg-zinc-700/20 text-zinc-400",
  };

  const labels = {
    active: "Activo",
    pending: "Pendiente",
    inactive: "Inactivo",
  };

  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${colors[status]}`}
    >
      {labels[status]}
    </span>
  );
}