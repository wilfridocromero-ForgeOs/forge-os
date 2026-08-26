const plural = (count, one, many) => count === 1 ? one : many;

export function buildDashboardBriefing(data) {
  if (!data) return "Aquí tienes el estado de tu empresa hoy.";
  const overdue = data.tasks?.available ? data.tasks.overdueCount || 0 : 0;
  const pending = data.discovery?.available ? data.discovery.pendingCount || 0 : 0;
  const taskPhrase = `${overdue} ${plural(overdue, "tarea vencida", "tareas vencidas")}`;
  const evaluationPhrase = `${pending} ${plural(pending, "evaluación pendiente", "evaluaciones pendientes")}`;

  if (overdue > 0 && pending > 0) return `Tu equipo tiene ${taskPhrase} y hay ${evaluationPhrase}.`;
  if (overdue > 0) return `Tu equipo tiene ${taskPhrase}.`;
  if (pending > 0) return `Hay ${evaluationPhrase}.`;
  return "Tu operación está al día.";
}

export function buildOrbNowBriefing(data) {
  if (!data) return { state: "loading", text: "Preparando el pulso operativo…" };
  const sources = [data.tasks, data.calendar, data.discovery, data.projects];
  if (sources.every((source) => source?.available === false)) return { state: "unavailable", text: "El contexto operativo no está disponible ahora. El resto del Dashboard sigue funcionando." };
  const facts = [];
  if (data.tasks?.available && data.tasks.overdueCount > 0) facts.push(`${data.tasks.overdueCount} ${plural(data.tasks.overdueCount, "tarea vencida", "tareas vencidas")}`);
  if (data.tasks?.available && data.tasks.today?.length > 0) facts.push(`${data.tasks.today.length} ${plural(data.tasks.today.length, "tarea para hoy", "tareas para hoy")}`);
  if (data.calendar?.available && data.calendar.today?.length > 0) facts.push(`${data.calendar.today.length} ${plural(data.calendar.today.length, "evento hoy", "eventos hoy")}`);
  if (data.discovery?.available && data.discovery.pendingCount > 0) facts.push(`${data.discovery.pendingCount} ${plural(data.discovery.pendingCount, "diagnóstico en curso", "diagnósticos en curso")}`);
  if (facts.length) return { state: "ready", text: `Ahora mismo hay ${facts.join(", ")}.` };
  const hasActivity = (data.projects?.available && (data.projects.count || 0) > 0) || (data.clients?.available && (data.clients.count || 0) > 0);
  return hasActivity ? { state: "ready", text: "No hay urgencias operativas visibles con los datos disponibles en este momento." } : { state: "empty", text: "Todavía no hay suficiente actividad para generar un insight operativo." };
}

export function buildDayHeading(data) {
  const overdue = data?.tasks?.mineOverdue?.length || 0;
  const today = data?.tasks?.today?.length || 0;
  const events = data?.calendar?.today?.length || 0;
  if (overdue + today + events === 0) return "Tu día está despejado";
  return `${overdue} ${plural(overdue, "vencida", "vencidas")} · ${today} para hoy · ${events} ${plural(events, "evento", "eventos")}`;
}

export function buildAttentionItems(data, { scorePath = "/orvesen-score", evaluationPath = "/discovery" } = {}) {
  if (!data) return [];
  const items = [];
  const overdue = data.tasks?.overdueCount || 0;
  if (data.tasks?.available && overdue > 0) {
    items.push({
      id: "overdue-tasks", priority: 1, tone: "critical",
      title: `${overdue} ${plural(overdue, "tarea está vencida", "tareas están vencidas")}`,
      description: "Hay trabajo activo que superó su fecha límite.",
      action: "Revisar tareas", to: "/proyectos",
    });
  }

  const score = data.score?.data;
  const coverage = Number(score?.snapshot?.coverage_percentage || 0);
  const threshold = Number(score?.model?.minimum_publishable_coverage || 60);
  if (data.score?.available && score?.model && (!score.snapshot || ["unevaluated", "insufficient_data"].includes(score.snapshot.status) || coverage < threshold)) {
    items.push({
      id: "score-coverage", priority: 2, tone: "warning",
      title: "Tu Score necesita más evidencia",
      description: `La cobertura empresarial está en ${coverage.toLocaleString("es-ES", { maximumFractionDigits: 1 })}%. Necesitas ${threshold.toLocaleString("es-ES", { maximumFractionDigits: 1 })}% para calcular el Master Score.`,
      action: "Continuar evaluación", to: evaluationPath,
    });
  }

  const pending = data.discovery?.pendingCount || 0;
  if (data.discovery?.available && pending > 0) {
    items.push({
      id: "pending-discovery", priority: 2, tone: "warning",
      title: `${pending} ${plural(pending, "evaluación está pendiente", "evaluaciones están pendientes")}`,
      description: "Puedes continuar desde la última respuesta guardada.",
      action: "Continuar Discovery", to: evaluationPath,
    });
  }

  const today = data.tasks?.today?.length || 0;
  if (data.tasks?.available && today > 0) {
    items.push({
      id: "today-tasks", priority: 3, tone: "neutral",
      title: `${today} ${plural(today, "tarea requiere", "tareas requieren")} atención hoy`,
      description: "Están asignadas a ti y tienen fecha para hoy.",
      action: "Ver mi día", to: "/calendario",
    });
  }

  if (!items.length && data.score?.available && score?.snapshot?.master_score != null) {
    items.push({
      id: "review-score", priority: 5, tone: "positive",
      title: "Tu resumen empresarial está actualizado",
      description: "No hay acciones críticas detectadas con los datos disponibles.",
      action: "Ver análisis", to: scorePath,
    });
  }
  return items.sort((left, right) => left.priority - right.priority).slice(0, 4);
}

export function buildDayItems(data) {
  if (!data) return [];
  const taskItems = [
    ...(data.tasks?.mineOverdue || []).map((item) => ({ ...item, dayStatus: "overdue", sortAt: item.dueAt })),
    ...(data.tasks?.today || []).map((item) => ({ ...item, dayStatus: "today", sortAt: item.dueAt || item.startsAt })),
  ].map((item) => ({
    id: item.key, kind: "task", title: item.title, context: item.projectName,
    date: item.sortAt, status: item.dayStatus, priority: item.priority,
    to: `/proyectos/${item.projectId}?tab=work&task=${item.taskId}`,
  }));
  const eventItems = (data.calendar?.today || []).map((item) => ({
    id: item.key, kind: "event", title: item.title, context: "Calendario",
    date: item.startsAt, status: "event", priority: item.priority, to: `/calendario?event=${item.sourceId}`,
  }));
  return [...taskItems, ...eventItems]
    .sort((left, right) => new Date(left.date) - new Date(right.date))
    .slice(0, 6);
}
