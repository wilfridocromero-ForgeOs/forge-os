import { supabase } from "../lib/supabase";

async function readTable(table, organizationId) {
  const { data, error, count } = await supabase
    .from(table)
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .limit(10);

  if (error) {
    console.warn(`No se pudo leer ${table}:`, error.message);
    return { rows: [], count: null, unavailable: true };
  }

  return { rows: data || [], count: count ?? 0, unavailable: false };
}

function eventDate(row) {
  return row.updated_at || row.created_at || row.completed_at || null;
}

function makeActivity(table, row) {
  const date = eventDate(row);
  const label = row.name || row.title || row.company || "Registro actualizado";
  const labels = {
    clients: "Cliente registrado",
    projects: "Proyecto actualizado",
    discoveries: "Discovery actualizado",
  };

  return {
    id: `${table}-${row.id}`,
    date,
    time: date
      ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(date))
      : "Sin fecha",
    title: labels[table],
    description: label,
  };
}

export async function getDashboardData(organizationId) {
  const [clients, projects, playbooks, discoveries] = await Promise.all([
    readTable("clients", organizationId),
    readTable("projects", organizationId),
    readTable("playbooks", organizationId),
    readTable("discoveries", organizationId),
  ]);

  const activities = [
    ...clients.rows.map((row) => makeActivity("clients", row)),
    ...projects.rows.map((row) => makeActivity("projects", row)),
    ...discoveries.rows.map((row) => makeActivity("discoveries", row)),
  ]
    .filter((item) => item.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 4);

  return { clients, projects, playbooks, discoveries, activities };
}
