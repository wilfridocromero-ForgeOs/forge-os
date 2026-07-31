// src/services/score.js

/**
 * ==========================================================
 * ORVESEN SCORE ENGINE
 * v1.0
 * ==========================================================
 *
 * Este archivo será el cerebro del ORVESEN Score.
 * Recibe información del Discovery y genera un
 * diagnóstico empresarial completo.
 *
 */

export function calculateScore(data = {}) {
  const categories = {
    vision: calculateVision(data),

    marketing: calculateMarketing(data),

    sales: calculateSales(data),

    operations: calculateOperations(data),

    finance: calculateFinance(data),

    clients: calculateClients(data),

    technology: calculateTechnology(data),
  };

  const total = Math.round(
    Object.values(categories).reduce((sum, value) => sum + value, 0) /
      Object.keys(categories).length
  );

  return {
    total,

    status: getStatus(total),

    improvement: 12,

    categories,

    strengths: getStrengths(categories),

    risks: getRisks(categories),

    recommendations: getRecommendations(categories),

    nextAction: getNextAction(categories),
  };
}

/* ==========================================================
   CATEGORY CALCULATIONS
========================================================== */

function calculateVision() {
  return 92;
}

function calculateMarketing() {
  return 91;
}

function calculateSales() {
  return 74;
}

function calculateOperations() {
  return 96;
}

function calculateFinance() {
  return 82;
}

function calculateClients() {
  return 79;
}

function calculateTechnology() {
  return 88;
}

/* ==========================================================
   STATUS
========================================================== */

function getStatus(score) {
  if (score >= 900)
    return "Elite";

  if (score >= 800)
    return "Organización Saludable";

  if (score >= 700)
    return "Crecimiento Estable";

  if (score >= 600)
    return "Necesita Optimización";

  if (score >= 500)
    return "Riesgo Operacional";

  return "Estado Crítico";
}

/* ==========================================================
   STRENGTHS
========================================================== */

function getStrengths(categories) {
  const strengths = [];

  if (categories.marketing >= 85)
    strengths.push(
      "Excelente estrategia de marketing."
    );

  if (categories.operations >= 85)
    strengths.push(
      "Procesos internos muy organizados."
    );

  if (categories.technology >= 85)
    strengths.push(
      "Infraestructura tecnológica sólida."
    );

  if (categories.finance >= 80)
    strengths.push(
      "Finanzas saludables."
    );

  return strengths;
}

/* ==========================================================
   RISKS
========================================================== */

function getRisks(categories) {
  const risks = [];

  if (categories.sales < 80)
    risks.push(
      "El proceso comercial necesita optimización."
    );

  if (categories.clients < 80)
    risks.push(
      "La experiencia del cliente puede mejorar."
    );

  if (categories.finance < 70)
    risks.push(
      "Existe riesgo financiero."
    );

  return risks;
}

/* ==========================================================
   RECOMMENDATIONS
========================================================== */

function getRecommendations(categories) {
  const recommendations = [];

  if (categories.sales < 80) {
    recommendations.push({
      title: "Optimizar Ventas",

      description:
        "Implementa un proceso de seguimiento comercial y documenta el SOP correspondiente.",
    });
  }

  if (categories.clients < 80) {
    recommendations.push({
      title: "Mejorar Experiencia del Cliente",

      description:
        "Revisa el proceso Discovery y fortalece la comunicación con los clientes.",
    });
  }

  if (categories.operations < 90) {
    recommendations.push({
      title: "Documentar Procesos",

      description:
        "Crear nuevos SOP reducirá errores y aumentará la escalabilidad.",
    });
  }

  return recommendations;
}

/* ==========================================================
   NEXT ACTION
========================================================== */

function getNextAction(categories) {
  if (categories.sales < 80) {
    return {
      title: "Optimizar Proceso Comercial",

      impact: 18,

      time: "25 min",

      description:
        "La mayor oportunidad actual está en el proceso comercial. Mejorar esta área incrementará significativamente el ORVESEN Score.",
    };
  }

  if (categories.clients < 80) {
    return {
      title: "Actualizar Discovery",

      impact: 14,

      time: "20 min",

      description:
        "Completa el Discovery para obtener un diagnóstico más preciso.",
    };
  }

  return {
    title: "Continuar Crecimiento",

    impact: 8,

    time: "15 min",

    description:
      "La empresa mantiene una trayectoria saludable. Continúa fortaleciendo los procesos actuales.",
  };
}