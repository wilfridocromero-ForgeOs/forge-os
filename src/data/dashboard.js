import { organization } from "./organization";
import { ai } from "./ai";

export const dashboardData = {
  greeting: {
    eyebrow: "ORVESEN PLATFORM",

    title: `Buenos días, ${organization.owner.firstName}.`,

    description: ai.greeting,
  },

  date: {
    day: "29",
    month: "Jul",
  },

  score: {
    total: organization.score.overall,
    max: 1000,
    status: organization.score.status,
    improvement: organization.score.improvement,

    description:
      "Tu organización mantiene una trayectoria saludable según el último análisis realizado por ORVESEN.",
  },

  ai: {
    title: "Recomendaciones estratégicas",

    recommendations: ai.recommendations,
  },

  metrics: [
    {
      id: "clients",

      title: "CLIENTES",

      value: "24",

      subtitle: "Clientes activos",

      trend: "+3 este mes",
    },

    {
      id: "projects",

      title: "PROYECTOS",

      value: organization.projects.active.toString(),

      subtitle: "En progreso",

      trend: `${organization.projects.completed} completados`,
    },

    {
      id: "playbooks",

      title: "PLAYBOOKS",

      value: organization.playbooks.completed.toString(),

      subtitle: "Documentados",

      trend: `${organization.playbooks.total} total`,
    },

    {
      id: "discovery",

      title: "DISCOVERY",

      value: `${organization.discovery.completed}%`,

      subtitle: "Completado",

      trend: `${organization.discovery.pending} pendientes`,
    },
  ],

  activities: [
    {
      id: 1,

      time: "09:10",

      title: "Nuevo cliente agregado",

      description: "DentalCare PR fue añadido al sistema.",
    },

    {
      id: 2,

      time: "10:25",

      title: "Discovery completado",

      description: "Se finalizó el diagnóstico inicial.",
    },

    {
      id: 3,

      time: "12:40",

      title: "Landing aprobada",

      description: "El cliente aprobó la página principal.",
    },

    {
      id: 4,

      time: "14:15",

      title: "Reunión programada",

      description: "Seguimiento para el próximo lunes.",
    },
  ],

  nextAction: {
    title: ai.nextAction.title,

    client: "DentalCare PR",

    duration: "25 minutos",

    priority: ai.nextAction.priority,

    impact: ai.nextAction.impact,

    description: ai.summary,
  },
};