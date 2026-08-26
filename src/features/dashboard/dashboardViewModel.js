const plural = (count, one, many) => (count === 1 ? one : many);

const DAY_MS = 24 * 60 * 60 * 1000;

const PRIORITY_WEIGHT = {
  urgent: 50,
  high: 40,
  medium: 25,
  normal: 15,
  low: 5,
};

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validDate(value) {
  if (!value) return null;

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function daysOverdue(value, now = new Date()) {
  const date = validDate(value);

  if (!date) return 0;

  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  const dueDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );

  return Math.max(
    0,
    Math.floor(
      (today.getTime() - dueDay.getTime()) / DAY_MS,
    ),
  );
}

function taskPriorityWeight(priority) {
  const normalized = String(
    priority || "normal",
  ).toLowerCase();

  return PRIORITY_WEIGHT[normalized] ?? PRIORITY_WEIGHT.normal;
}

function taskPriorityLabel(priority) {
  const normalized = String(
    priority || "normal",
  ).toLowerCase();

  const labels = {
    urgent: "Prioridad urgente",
    high: "Prioridad alta",
    medium: "Prioridad media",
    normal: "Prioridad normal",
    low: "Prioridad baja",
  };

  return labels[normalized] || "Prioridad normal";
}

function taskStatusWeight(status) {
  switch (status) {
    case "blocked":
      return 20;

    case "in_progress":
      return 8;

    default:
      return 0;
  }
}

/*
 * =========================================================
 * PRIORITY ENGINE V1
 * =========================================================
 *
 * Esta es la única fuente de verdad para:
 *
 * - el orden del bloque Prioridad;
 * - la interpretación de Orb;
 * - la recomendación principal.
 *
 * El motor NO inventa impacto empresarial.
 * Solo utiliza señales que realmente existen:
 *
 * - vencimiento;
 * - antigüedad del atraso;
 * - prioridad;
 * - estado;
 * - asignación;
 * - trabajo de hoy;
 * - Discovery;
 * - Score.
 */

function rankTask(task, {
  now = new Date(),
  isAssignedToCurrentUser = false,
} = {}) {
  const overdueDays = daysOverdue(
    task.dueAt || task.startsAt,
    now,
  );

  const priorityWeight = taskPriorityWeight(task.priority);
  const statusWeight = taskStatusWeight(task.status);

  // El atraso aumenta progresivamente, pero tiene techo.
  const overdueWeight = Math.min(overdueDays * 6, 42);

  // Una tarea propia recibe una pequeña ventaja,
  // pero nunca suficiente para falsear la urgencia real.
  const assignmentWeight = isAssignedToCurrentUser ? 5 : 0;

  const score =
    100 +
    priorityWeight +
    statusWeight +
    overdueWeight +
    assignmentWeight;

  return {
    ...task,

    intelligence: {
  type: "overdue-task",
  score,
  overdueDays,
  priorityWeight,
  statusWeight,
  overdueWeight,
  assignmentWeight,
  priorityLabel: taskPriorityLabel(task.priority),

  reason: [
    taskPriorityLabel(task.priority),
    overdueDays > 0
      ? `${overdueDays} ${plural(
          overdueDays,
          "día de atraso",
          "días de atraso",
        )}`
      : null,
    task.status === "blocked"
      ? "Trabajo bloqueado"
      : null,
    isAssignedToCurrentUser
      ? "Asignada a ti"
      : null,
  ]
    .filter(Boolean)
    .join(" · "),
},
  };
}

export function buildPriorityEngine(
  data,
  {
    scorePath = "/orvesen-score",
    evaluationPath = "/discovery",
    now = new Date(),
  } = {},
) {
  if (!data) {
    return {
      state: "loading",
      actions: [],
      tasks: [],
      primary: null,
      secondary: null,
      context: null,
    };
  }

  const tasksAvailable =
    data.tasks?.available === true;

  const calendarAvailable =
    data.calendar?.available === true;

  const discoveryAvailable =
    data.discovery?.available === true;

  const scoreAvailable =
    data.score?.available === true;

  const projectsAvailable =
    data.projects?.available === true;

  const clientsAvailable =
    data.clients?.available === true;

  /*
   * -------------------------------------------------------
   * TAREAS VENCIDAS
   * -------------------------------------------------------
   */

  const overdueTasks = tasksAvailable
    ? (data.tasks?.overdue || [])
        .map((task) =>
          rankTask(task, { now }),
        )
        .sort((left, right) => {
          if (
            right.intelligence.score !==
            left.intelligence.score
          ) {
            return (
              right.intelligence.score -
              left.intelligence.score
            );
          }

          const leftDate = validDate(
            left.dueAt || left.startsAt,
          );

          const rightDate = validDate(
            right.dueAt || right.startsAt,
          );

          if (leftDate && rightDate) {
            return (
              leftDate.getTime() -
              rightDate.getTime()
            );
          }

          return String(left.title || "")
            .localeCompare(
              String(right.title || ""),
              "es",
            );
        })
    : [];

  /*
   * -------------------------------------------------------
   * TRABAJO DE HOY
   * -------------------------------------------------------
   */

  const todayTasks = tasksAvailable
    ? data.tasks?.today || []
    : [];

  const todayEvents = calendarAvailable
    ? data.calendar?.today || []
    : [];

  /*
   * -------------------------------------------------------
   * DISCOVERY
   * -------------------------------------------------------
   */

  const pendingDiscovery =
    discoveryAvailable
      ? safeNumber(
          data.discovery?.pendingCount,
        )
      : null;

  /*
   * -------------------------------------------------------
   * SCORE
   * -------------------------------------------------------
   */

  const scoreData =
    scoreAvailable
      ? data.score?.data
      : null;

  const scoreCoverage =
    scoreData?.snapshot?.coverage_percentage != null
      ? safeNumber(
          scoreData.snapshot.coverage_percentage,
        )
      : null;

  const scoreThreshold =
    scoreData?.model
      ?.minimum_publishable_coverage != null
      ? safeNumber(
          scoreData.model
            .minimum_publishable_coverage,
          60,
        )
      : null;

  const scoreGap =
    scoreCoverage != null &&
    scoreThreshold != null
      ? Math.max(
          0,
          scoreThreshold - scoreCoverage,
        )
      : null;

  const scoreNeedsEvidence =
    scoreCoverage != null &&
    scoreThreshold != null &&
    scoreCoverage < scoreThreshold;

    const discoveryScore =
  pendingDiscovery > 0
    ? 35 +
      Math.min(pendingDiscovery * 4, 12) +
      (scoreNeedsEvidence ? 12 : 0) +
      (scoreGap != null && scoreGap <= 10 ? 6 : 0)
    : 0;

const scoreActionScore =
  scoreNeedsEvidence
    ? 30 +
      Math.min(scoreGap || 0, 20)
    : 0;

  /*
   * -------------------------------------------------------
   * CONTEXTO OPERATIVO
   * -------------------------------------------------------
   */

  const hasTodayWork =
    todayTasks.length > 0 ||
    todayEvents.length > 0;

  const hasFreeDay =
    tasksAvailable &&
    calendarAvailable &&
    todayTasks.length === 0 &&
    todayEvents.length === 0;

  const activeProjects =
    projectsAvailable
      ? safeNumber(data.projects?.count)
      : null;

  const activeClients =
    clientsAvailable
      ? safeNumber(data.clients?.count)
      : null;

  /*
   * -------------------------------------------------------
   * ACTION QUEUE
   * -------------------------------------------------------
   *
   * Esta misma lista alimenta las tarjetas de Prioridad.
   */

  const actions = overdueTasks.map(
    (task, index) => ({
      id:
        `overdue-task-${
          task.taskId ||
          task.sourceId ||
          task.id ||
          index
        }`,

      kind: "task",

      rank: index + 1,

      score: task.intelligence.score,

      tone: "critical",

      title:
        task.title ||
        "Tarea vencida",

      description:
        buildPriorityTaskDescription(
          task,
        ),

      action: "Abrir tarea",

      to: task.projectId
        ? `/proyectos/${task.projectId}` +
          `?tab=work&task=${
            task.taskId ||
            task.sourceId ||
            ""
          }`
        : "/proyectos",

      task,
    }),
  );

  /*
   * Discovery se convierte en una acción estratégica
   * posterior al trabajo operativo.
   */

  if (
    pendingDiscovery != null &&
    pendingDiscovery > 0
  ) {
    actions.push({
      id: "pending-discovery",
      kind: "discovery",
      rank: actions.length + 1,
score: discoveryScore,      tone: "warning",

      title: plural(
        pendingDiscovery,
        "Continuar diagnóstico pendiente",
        `Continuar ${pendingDiscovery} diagnósticos pendientes`,
      ),

      description:
        scoreNeedsEvidence &&
        scoreCoverage != null
          ? `La cobertura del Score está en ${scoreCoverage.toLocaleString(
              "es-ES",
              {
                maximumFractionDigits: 1,
              },
            )}%. Avanzar el diagnóstico puede aportar más evidencia.`
          : "Hay una evaluación iniciada que todavía puede aportar contexto a la lectura empresarial.",

      action: "Continuar Discovery",
      to: evaluationPath,
    });
  }

  /*
   * Score solo entra como acción independiente cuando
   * necesita evidencia y no existe Discovery pendiente
   * que ya pueda contribuir a esa cobertura.
   */

  if (
    scoreNeedsEvidence &&
    !(pendingDiscovery > 0)
  ) {
    actions.push({
      id: "score-coverage",
      kind: "score",
      rank: actions.length + 1,
score: scoreActionScore,      tone: "warning",

      title: "Completar evidencia del Score",

      description:
        `Cobertura actual: ${scoreCoverage.toLocaleString(
          "es-ES",
          {
            maximumFractionDigits: 1,
          },
        )}%. Se requiere ${scoreThreshold.toLocaleString(
          "es-ES",
          {
            maximumFractionDigits: 1,
          },
        )}% para completar el Master Score.`,

      action: "Ver Score",
      to: scorePath,
    });
  }

  /*
   * Si no hay vencidas, las tareas de hoy sí pueden
   * ocupar el frente de la cola.
   */

  if (
    overdueTasks.length === 0 &&
    todayTasks.length > 0
  ) {
    todayTasks.forEach(
      (task, index) => {
        actions.unshift({
          id:
            `today-task-${
              task.taskId ||
              task.sourceId ||
              index
            }`,

          kind: "today-task",
          rank: index + 1,
score:
  55 +
  taskPriorityWeight(task.priority) +
  taskStatusWeight(task.status),          tone: "neutral",

          title:
            task.title ||
            "Tarea para hoy",

          description:
            task.projectName
              ? `${task.projectName} · Programada para hoy.`
              : "Programada para hoy.",

          action: "Abrir tarea",

          to: task.projectId
            ? `/proyectos/${task.projectId}` +
              `?tab=work&task=${
                task.taskId ||
                task.sourceId ||
                ""
              }`
            : "/proyectos",

          task,
        });
      },
    );
  }

  /*
   * Recalculamos rank visual después de construir
   * la cola completa.
   */

 actions.sort((left, right) => {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  // Si dos acciones tienen el mismo score,
  // priorizamos trabajo operativo concreto.
  const kindWeight = {
    task: 4,
    "today-task": 3,
    discovery: 2,
    score: 1,
  };

  return (
    (kindWeight[right.kind] || 0) -
    (kindWeight[left.kind] || 0)
  );
});

actions.forEach((action, index) => {
  action.rank = index + 1;
});

  return {
    state: "ready",

    actions,

    tasks: overdueTasks,

    primary: actions[0] || null,
    secondary: actions[1] || null,

    context: {
      overdueCount:
        overdueTasks.length,

      todayTaskCount:
        todayTasks.length,

      todayEventCount:
        todayEvents.length,

      pendingDiscovery,

      scoreCoverage,
      scoreThreshold,
      scoreGap,
      scoreNeedsEvidence,

      hasTodayWork,
      hasFreeDay,

      activeProjects,
      activeClients,

      sources: {
        tasks: tasksAvailable,
        calendar: calendarAvailable,
        discovery: discoveryAvailable,
        score: scoreAvailable,
        projects: projectsAvailable,
        clients: clientsAvailable,
      },
    },
  };
}

function buildPriorityTaskDescription(task) {
  const parts = [];

  if (task.projectName) {
    parts.push(task.projectName);
  }

  const overdueDays =
    task.intelligence?.overdueDays || 0;

  if (overdueDays <= 0) {
    parts.push("Vencida");
  } else if (overdueDays === 1) {
    parts.push("Vencida hace 1 día");
  } else {
    parts.push(
      `Vencida hace ${overdueDays} días`,
    );
  }

  parts.push(
    task.intelligence?.priorityLabel ||
      taskPriorityLabel(task.priority),
  );

  if (task.status === "blocked") {
    parts.push("Bloqueada");
  }

  return parts.join(" · ");
}

/*
 * =========================================================
 * DASHBOARD BRIEFING
 * =========================================================
 */

export function buildDashboardBriefing(data) {
  if (!data) {
    return "Aquí tienes el estado de tu empresa hoy.";
  }

  const overdue =
    data.tasks?.available
      ? data.tasks.overdueCount || 0
      : 0;

  const pending =
    data.discovery?.available
      ? data.discovery.pendingCount || 0
      : 0;

  const taskPhrase =
    `${overdue} ${plural(
      overdue,
      "tarea vencida",
      "tareas vencidas",
    )}`;

  const evaluationPhrase =
    `${pending} ${plural(
      pending,
      "evaluación pendiente",
      "evaluaciones pendientes",
    )}`;

  if (overdue > 0 && pending > 0) {
    return (
      `Tu equipo tiene ${taskPhrase} ` +
      `y hay ${evaluationPhrase}.`
    );
  }

  if (overdue > 0) {
    return `Tu equipo tiene ${taskPhrase}.`;
  }

  if (pending > 0) {
    return `Hay ${evaluationPhrase}.`;
  }

  return "Tu operación está al día.";
}

/*
 * =========================================================
 * ORB · ANÁLISIS DE HOY
 * =========================================================
 *
 * Orb YA NO calcula su propia prioridad.
 *
 * Lee exactamente el mismo Priority Engine que alimenta
 * el bloque "Lo que requiere tu atención".
 */

export function buildOrbNowBriefing(data) {
  if (!data) {
    return {
      state: "loading",
      title: "Preparando tu análisis operativo",
      text:
        "Estoy reuniendo el estado actual de tu operación.",
      recommendation: null,
    };
  }

  const engine =
    buildPriorityEngine(data);

  const {
    actions,
    tasks,
    primary,
    secondary,
    context,
  } = engine;

  if (!context) {
    return {
      state: "unavailable",
      title:
        "El análisis operativo no está disponible",
      text:
        "No hay suficiente contexto disponible para construir una recomendación confiable.",
      recommendation: null,
    };
  }

  const {
    overdueCount,
    todayTaskCount,
    todayEventCount,
    pendingDiscovery,
    scoreCoverage,
    scoreThreshold,
    scoreGap,
    scoreNeedsEvidence,
    hasFreeDay,
    activeProjects,
  } = context;

  /*
   * -------------------------------------------------------
   * ESCENARIO 1:
   * EXISTE TRABAJO VENCIDO
   * -------------------------------------------------------
   */

  if (
    overdueCount > 0 &&
    primary?.kind === "task"
  ) {
    const firstTask = primary.task;

    const firstDays =
      firstTask?.intelligence
        ?.overdueDays || 0;

    const firstPriority =
      firstTask?.intelligence
        ?.priorityLabel ||
      taskPriorityLabel(
        firstTask?.priority,
      );

    let text =
      `Tienes ${overdueCount} ${plural(
        overdueCount,
        "tarea vencida",
        "tareas vencidas",
      )}. `;

    /*
     * Si existe más de una tarea, Orb explica por qué
     * una quedó por encima de las demás.
     */
    if (overdueCount > 1) {
      text +=
        `No todas tienen el mismo nivel de atención. ` +
        `“${firstTask.title}” encabeza la cola porque combina ${firstPriority.toLowerCase()}`;

      if (firstDays > 0) {
        text +=
          ` con ${firstDays} ${plural(
            firstDays,
            "día de atraso",
            "días de atraso",
          )}`;
      }

      if (
        firstTask.status === "blocked"
      ) {
        text +=
          " y además está bloqueada";
      }

      text += ".";
    } else {
      text +=
        `“${firstTask.title}” es el principal punto de atención operativo`;
      if (firstDays > 0) {
        text +=
          ` y lleva ${firstDays} ${plural(
            firstDays,
            "día vencida",
            "días vencida",
          )}`;
      }

      text += ".";
    }

    /*
     * Capacidad de hoy.
     */
    if (hasFreeDay) {
      text +=
        "\n\nHoy no tienes tareas ni eventos programados. Eso crea espacio operativo para reducir el atraso sin desplazar trabajo ya planificado.";
    } else if (
      todayTaskCount > 0 ||
      todayEventCount > 0
    ) {
      const commitments = [];

      if (todayTaskCount > 0) {
        commitments.push(
          `${todayTaskCount} ${plural(
            todayTaskCount,
            "tarea",
            "tareas",
          )} para hoy`,
        );
      }

      if (todayEventCount > 0) {
        commitments.push(
          `${todayEventCount} ${plural(
            todayEventCount,
            "evento",
            "eventos",
          )}`,
        );
      }

      text +=
        `\n\nTambién tienes ${commitments.join(
          " y ",
        )}. El atraso debe reducirse sin comprometer esos compromisos actuales.`;
    }

    /*
     * Discovery + Score se relacionan únicamente
     * si los datos realmente existen.
     */
    if (
      pendingDiscovery > 0 &&
      scoreNeedsEvidence &&
      scoreCoverage != null &&
      scoreThreshold != null
    ) {
      text +=
        `\n\nDespués del frente operativo tienes ${pendingDiscovery} ${plural(
          pendingDiscovery,
          "diagnóstico pendiente",
          "diagnósticos pendientes",
        )}. La cobertura del Score está en ${scoreCoverage.toLocaleString(
          "es-ES",
          {
            maximumFractionDigits: 1,
          },
        )}%, a ${scoreGap.toLocaleString(
          "es-ES",
          {
            maximumFractionDigits: 1,
          },
        )} ${plural(
          scoreGap,
          "punto porcentual",
          "puntos porcentuales",
        )} del ${scoreThreshold.toLocaleString(
          "es-ES",
          {
            maximumFractionDigits: 1,
          },
        )}% necesario.`;
    }

    let recommendation =
      `Empezaría por “${firstTask.title}”.`;

    if (
      secondary?.kind === "task"
    ) {
      recommendation +=
        ` Después continuaría con “${secondary.title}”.`;
    } else if (
      secondary?.kind === "discovery"
    ) {
      recommendation +=
        " Después avanzaría el diagnóstico pendiente.";
    }

    if (
      pendingDiscovery > 0 &&
      !actions
        .slice(0, 2)
        .some(
          (action) =>
            action.kind === "discovery",
        )
    ) {
      recommendation +=
        " Una vez reducido el atraso, usaría la capacidad restante para avanzar Discovery.";
    }

    return {
      state: "ready",
      title:
        `“${firstTask.title}” encabeza la prioridad operativa`,
      text,
      recommendation,
      priorityEngine: engine,
    };
  }

  /*
   * -------------------------------------------------------
   * ESCENARIO 2:
   * NO HAY ATRASO, PERO HAY TRABAJO HOY
   * -------------------------------------------------------
   */

  if (
    todayTaskCount > 0 ||
    todayEventCount > 0
  ) {
    const parts = [];

    if (todayTaskCount > 0) {
      parts.push(
        `${todayTaskCount} ${plural(
          todayTaskCount,
          "tarea",
          "tareas",
        )}`,
      );
    }

    if (todayEventCount > 0) {
      parts.push(
        `${todayEventCount} ${plural(
          todayEventCount,
          "evento",
          "eventos",
        )}`,
      );
    }

    return {
      state: "ready",

      title:
        "El foco está en ejecutar bien el trabajo de hoy",

      text:
        `No detecto trabajo vencido. Hoy tienes ${parts.join(
          " y ",
        )}, por lo que la prioridad es proteger esos compromisos y evitar generar nuevo atraso.`,

      recommendation:
        primary?.kind === "today-task"
          ? `Empezaría por “${primary.title}” y mantendría el resto del trabajo de hoy en orden antes de abrir nuevas prioridades.`
          : "Mantendría el foco en los compromisos de hoy antes de abrir trabajo adicional.",

      priorityEngine: engine,
    };
  }

  /*
   * -------------------------------------------------------
   * ESCENARIO 3:
   * DISCOVERY PUEDE AYUDAR AL SCORE
   * -------------------------------------------------------
   */

  if (
    pendingDiscovery > 0 &&
    scoreNeedsEvidence
  ) {
    return {
      state: "ready",

      title:
        "Discovery es ahora la mejor oportunidad de avance",

      text:
        `No detecto trabajo operativo vencido ni compromisos para hoy. Tienes ${pendingDiscovery} ${plural(
          pendingDiscovery,
          "diagnóstico pendiente",
          "diagnósticos pendientes",
        )} y la cobertura del Score está en ${scoreCoverage.toLocaleString(
          "es-ES",
          {
            maximumFractionDigits: 1,
          },
        )}%, por debajo del ${scoreThreshold.toLocaleString(
          "es-ES",
          {
            maximumFractionDigits: 1,
          },
        )}% necesario.`,

      recommendation:
        "Aprovecharía la capacidad disponible para avanzar Discovery y aumentar la evidencia que alimenta la lectura empresarial.",

      priorityEngine: engine,
    };
  }

  /*
   * -------------------------------------------------------
   * ESCENARIO 4:
   * DISCOVERY PENDIENTE
   * -------------------------------------------------------
   */

  if (pendingDiscovery > 0) {
    return {
      state: "ready",

      title:
        "Hay espacio para avanzar el diagnóstico",

      text:
        `La operación inmediata está despejada y tienes ${pendingDiscovery} ${plural(
          pendingDiscovery,
          "diagnóstico pendiente",
          "diagnósticos pendientes",
        )}. Ese trabajo puede aportar nueva información para orientar las siguientes decisiones.`,

      recommendation:
        "Usaría la capacidad disponible para continuar Discovery.",

      priorityEngine: engine,
    };
  }

  /*
   * -------------------------------------------------------
   * ESCENARIO 5:
   * OPERACIÓN ESTABLE
   * -------------------------------------------------------
   */

  if (activeProjects > 0) {
    return {
      state: "ready",

      title:
        "La operación no presenta alertas inmediatas",

      text:
        `No detecto trabajo vencido, compromisos para hoy ni diagnósticos pendientes. Hay ${activeProjects} ${plural(
          activeProjects,
          "proyecto activo",
          "proyectos activos",
        )}, pero las señales disponibles no muestran presión operativa inmediata.`,

      recommendation:
        "Mantendría el seguimiento de los proyectos activos y aprovecharía la capacidad disponible para adelantar trabajo de valor.",

      priorityEngine: engine,
    };
  }

  /*
   * -------------------------------------------------------
   * SIN CONTEXTO SUFICIENTE
   * -------------------------------------------------------
   */

  return {
    state: "empty",

    title:
      "Todavía no hay suficiente actividad para analizar",

    text:
      "No hay suficiente actividad registrada para identificar una prioridad empresarial confiable en este momento.",

    recommendation:
      "A medida que registres trabajo, Orb podrá construir una lectura más útil.",

    priorityEngine: engine,
  };
}

/*
 * =========================================================
 * BLOQUE PRIORIDAD
 * =========================================================
 *
 * Consume EXACTAMENTE buildPriorityEngine().
 */

export function buildAttentionItems(
  data,
  {
    scorePath = "/orvesen-score",
    evaluationPath = "/discovery",
  } = {},
) {
  if (!data) return [];

  const engine =
    buildPriorityEngine(data, {
      scorePath,
      evaluationPath,
    });

  return engine.actions
  .slice(0, 5)
  .map((action) => ({
    id: action.id,
    tone: action.tone,
    title: action.title,
    description: action.description,
    action: action.action,
    to: action.to,
    kind: action.kind,
    rank: action.rank,
    score: action.score,
    reason:
      action.task?.intelligence?.reason ||
      action.reason ||
      null,
  }));
}

/*
 * =========================================================
 * TU DÍA
 * =========================================================
 */

export function buildDayHeading(data) {
  const overdue =
    data?.tasks?.mineOverdue?.length || 0;

  const today =
    data?.tasks?.today?.length || 0;

  const events =
    data?.calendar?.today?.length || 0;

  if (
    overdue +
      today +
      events ===
    0
  ) {
    return "Tu día está despejado";
  }

  return (
    `${overdue} ${plural(
      overdue,
      "vencida",
      "vencidas",
    )} · ` +
    `${today} para hoy · ` +
    `${events} ${plural(
      events,
      "evento",
      "eventos",
    )}`
  );
}

export function buildDayItems(data) {
  if (!data) return [];

  const taskItems = [
    ...(data.tasks?.mineOverdue || []).map(
      (item) => ({
        ...item,
        dayStatus: "overdue",
        sortAt: item.dueAt,
      }),
    ),

    ...(data.tasks?.today || []).map(
      (item) => ({
        ...item,
        dayStatus: "today",
        sortAt:
          item.dueAt ||
          item.startsAt,
      }),
    ),
  ].map((item) => ({
    id: item.key,

    kind: "task",

    title: item.title,

    context:
      item.projectName,

    date:
      item.sortAt,

    status:
      item.dayStatus,

    priority:
      item.priority,

    to:
      `/proyectos/${item.projectId}` +
      `?tab=work&task=${item.taskId}`,
  }));

  const eventItems =
    (data.calendar?.today || []).map(
      (item) => ({
        id: item.key,

        kind: "event",

        title: item.title,

        context: "Calendario",

        date: item.startsAt,

        status: "event",

        priority: item.priority,

        to:
          `/calendario?event=${item.sourceId}`,
      }),
    );

  return [
    ...taskItems,
    ...eventItems,
  ]
    .sort(
      (left, right) =>
        new Date(left.date) -
        new Date(right.date),
    )
    .slice(0, 6);
}