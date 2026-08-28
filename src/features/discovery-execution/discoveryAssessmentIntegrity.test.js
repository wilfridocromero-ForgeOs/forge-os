import assert from "node:assert/strict";
import test from "node:test";

import {
  assessmentProgress,
  assessmentQuestionIds,
  assessmentStructureMatches,
  safeDiscoveryErrorDiagnostic,
} from "./discoveryAssessmentIntegrity.js";

const answered = (value) => value !== null && value !== undefined && value !== "";

function assessment(questionIds, responseIds = questionIds) {
  return {
    discovery_templates: {
      discovery_sections: [
        { id: "section-a", discovery_questions: questionIds.slice(0, 10).map((id) => ({ id })) },
        { id: "section-b", discovery_questions: questionIds.slice(10).map((id) => ({ id })) },
      ],
    },
    discovery_responses: responseIds.map((id) => ({ discovery_question_id: id, response_value: "Sí" })),
  };
}

test("published structures retain every unique question without join multiplication", () => {
  const twenty = assessment(Array.from({ length: 20 }, (_, index) => `q-${index + 1}`));
  const twentyTwo = assessment(Array.from({ length: 22 }, (_, index) => `q-${index + 1}`));
  assert.equal(assessmentQuestionIds(twenty).length, 20);
  assert.equal(assessmentQuestionIds(twentyTwo).length, 22);
  assert.equal(new Set(assessmentQuestionIds(twentyTwo)).size, 22);
});

test("progress and finalization readiness use the same assessment question set", () => {
  const ids = Array.from({ length: 20 }, (_, index) => `q-${index + 1}`);
  assert.deepEqual(assessmentProgress(assessment(ids), answered), { answered: 20, total: 20, percentage: 100 });
  assert.deepEqual(assessmentProgress(assessment(ids, ids.slice(0, 19)), answered), { answered: 19, total: 20, percentage: 95 });
});

test("responses outside the current structure cannot inflate progress", () => {
  const value = assessment(["q-1", "q-2"], ["q-1", "q-2", "deleted-question"]);
  assert.deepEqual(assessmentProgress(value, answered), { answered: 2, total: 2, percentage: 100 });
});

test("reload and authorized users compare the same canonical structure", () => {
  const ids = Array.from({ length: 22 }, (_, index) => `q-${index + 1}`);
  assert.equal(assessmentStructureMatches(assessment(ids), assessment(ids)), true);
});

test("a later template edit is detected before finalization", () => {
  const original = assessment(["q-1", "q-2"]);
  const added = assessment(["q-1", "q-2", "q-3"]);
  const removed = assessment(["q-1"]);
  const reordered = assessment(["q-2", "q-1"]);
  assert.equal(assessmentStructureMatches(original, added), false);
  assert.equal(assessmentStructureMatches(original, removed), false);
  assert.equal(assessmentStructureMatches(original, reordered), true);
});

test("finalization diagnostics preserve Supabase fields without leaking identifiers or tokens", () => {
  const diagnostic = safeDiscoveryErrorDiagnostic({
    code: "P0001",
    message: "Division 9b24e51d-00a1-4f28-b443-8864d3a61ebe is invalid",
    details: "Bearer secret-token",
    hint: "eyJhbGciOiJIUzI1NiJ9.payload.signature",
  });
  assert.deepEqual(diagnostic, {
    code: "P0001",
    message: "Division [UUID_REDACTED] is invalid",
    details: "Bearer [REDACTED]",
    hint: "[JWT_REDACTED]",
  });
});
