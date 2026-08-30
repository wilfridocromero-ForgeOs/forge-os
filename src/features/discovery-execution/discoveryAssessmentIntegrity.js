export function assessmentQuestions(assessment) {
  return (assessment?.discovery_templates?.discovery_sections || [])
    .flatMap((section) => section.discovery_questions || []);
}

export function assessmentQuestionIds(assessment) {
  return assessmentQuestions(assessment).map((question) => question.id);
}

export function assessmentStructureMatches(left, right) {
  const leftScopeMatches = (left?.division_id || null) === (left?.discovery_templates?.division_id || null);
  const rightScopeMatches = (right?.division_id || null) === (right?.discovery_templates?.division_id || null);
  const leftIds = new Set(assessmentQuestionIds(left));
  const rightIds = new Set(assessmentQuestionIds(right));
  return leftScopeMatches && rightScopeMatches
    && leftIds.size === rightIds.size
    && [...leftIds].every((questionId) => rightIds.has(questionId));
}

export function assessmentProgress(assessment, isAnswered) {
  const questionIds = new Set(assessmentQuestionIds(assessment));
  const answeredIds = new Set((assessment?.discovery_responses || [])
    .filter((response) => questionIds.has(response.discovery_question_id))
    .filter((response) => isAnswered(response.response_value))
    .map((response) => response.discovery_question_id));
  return {
    answered: answeredIds.size,
    total: questionIds.size,
    percentage: questionIds.size ? Math.round(answeredIds.size / questionIds.size * 100) : 0,
  };
}

function sanitizeDiagnosticValue(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .replace(/bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT_REDACTED]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[UUID_REDACTED]")
    .slice(0, 500);
}

export function safeDiscoveryErrorDiagnostic(error) {
  return {
    code: sanitizeDiagnosticValue(error?.code),
    message: sanitizeDiagnosticValue(error?.message),
    details: sanitizeDiagnosticValue(error?.details),
    hint: sanitizeDiagnosticValue(error?.hint),
  };
}
