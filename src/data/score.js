// src/data/score.js

export const scoreData = {
  // ==========================
  // Score General
  // ==========================

  score: 867,

  max: 1000,

  status: "Organización Saludable",

  improvement: 12,

  description:
    "La organización mantiene una trayectoria saludable. ORVESEN IA ha detectado oportunidades para fortalecer ventas, automatización y estandarización de procesos.",

  // ==========================
  // Categorías
  // ==========================

  categories: [
    {
      title: "Marketing",
      score: 91,
      description:
        "Excelente posicionamiento y estrategia digital.",
    },

    {
      title: "Ventas",
      score: 74,
      description:
        "Existen oportunidades para aumentar la conversión.",
    },

    {
      title: "Operaciones",
      score: 96,
      description:
        "Procesos altamente organizados y documentados.",
    },

    {
      title: "Finanzas",
      score: 82,
      description:
        "Flujo financiero estable y saludable.",
    },

    {
      title: "Clientes",
      score: 79,
      description:
        "Buen nivel de satisfacción general.",
    },

    {
      title: "Tecnología",
      score: 88,
      description:
        "Infraestructura moderna y estable.",
    },
  ],

  // ==========================
  // Fortalezas
  // ==========================

  strengths: [
    "Procesos internos bien documentados.",
    "Excelente organización operativa.",
    "Marketing con alto rendimiento.",
    "Infraestructura tecnológica sólida.",
    "Crecimiento constante durante los últimos meses.",
  ],

  // ==========================
  // Riesgos
  // ==========================

  risks: [
    "Seguimiento comercial inconsistente.",
    "Discovery pendiente en algunos clientes.",
    "Faltan SOP para varios procesos.",
    "Existen oportunidades de automatización.",
  ],

  // ==========================
  // Recomendaciones IA
  // ==========================

  recommendations: [
    {
      title: "Completar Discovery",
      description:
        "Finaliza los diagnósticos pendientes para aumentar la precisión del ORVESEN Score.",
    },

    {
      title: "Crear SOP Comercial",
      description:
        "Documentar el proceso comercial aumentará la consistencia del equipo.",
    },

    {
      title: "Automatizar Seguimientos",
      description:
        "Implementa recordatorios automáticos para mejorar la conversión.",
    },
  ],

  // ==========================
  // Acción Prioritaria
  // ==========================

  actionPlan: {
    title: "Completar Discovery",

    impact: 18,

    time: "25 min",

    description:
      "Completa el Discovery pendiente para desbloquear un análisis más preciso y aumentar el ORVESEN Score de la organización.",
  },

  // ==========================
  // Historial
  // ==========================

  history: [
    {
      month: "Ene",
      score: 742,
    },
    {
      month: "Feb",
      score: 758,
    },
    {
      month: "Mar",
      score: 776,
    },
    {
      month: "Abr",
      score: 801,
    },
    {
      month: "May",
      score: 824,
    },
    {
      month: "Jun",
      score: 848,
    },
    {
      month: "Jul",
      score: 867,
    },
  ],
};