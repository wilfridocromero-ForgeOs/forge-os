function Dashboard() {
  return (
    <div className="p-8">
      <div className="mb-10">
        <h1 className="text-5xl font-bold text-yellow-400">
          Dashboard
        </h1>

        <p className="mt-2 text-gray-400 text-lg">
          Bienvenido nuevamente, Wilfrido.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-6">
        <DashboardCard
          title="Clientes"
          value="0"
          color="text-green-500"
          icon="👥"
        />

        <DashboardCard
          title="Proyectos"
          value="0"
          color="text-blue-500"
          icon="📁"
        />

        <DashboardCard
          title="Ventas"
          value="$0"
          color="text-yellow-400"
          icon="💰"
        />

        <DashboardCard
          title="Discovery"
          value="0"
          color="text-purple-500"
          icon="🧠"
        />
      </div>
    </div>
  );
}

function DashboardCard({ title, value, color, icon }) {
  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-lg transition duration-300 hover:border-yellow-400 hover:scale-[1.02]">
      <div className="mb-4 text-4xl">
        {icon}
      </div>

      <h3 className="mb-2 text-lg font-semibold text-gray-300">
        {title}
      </h3>

      <h2 className={`text-4xl font-bold ${color}`}>
        {value}
      </h2>
    </div>
  );
}

export default Dashboard;