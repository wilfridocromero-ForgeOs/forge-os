export default function ClientMetrics({
  discovery = "82%",
  playbooks = 12,
  projects = 4,
  improvement = "+18",
}) {
  const metrics = [
    {
      title: "DISCOVERY",
      value: discovery,
      subtitle: "Completado",
    },
    {
      title: "PLAYBOOKS",
      value: playbooks,
      subtitle: "Documentados",
    },
    {
      title: "PROYECTOS",
      value: projects,
      subtitle: "Activos",
    },
    {
      title: "IA",
      value: improvement,
      subtitle: "Impacto",
    },
  ];

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-8">
      {metrics.map((item) => (
        <div
          key={item.title}
          className="border-l border-white/5 pl-6"
        >
          <p className="text-xs uppercase tracking-[0.30em] text-zinc-500">
            {item.title}
          </p>

          <h2 className="mt-5 text-4xl font-semibold text-white">
            {item.value}
          </h2>

          <p className="mt-2 text-sm text-zinc-500">
            {item.subtitle}
          </p>
        </div>
      ))}
    </div>
  );
}