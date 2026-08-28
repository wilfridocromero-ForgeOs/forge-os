import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./OrbActionProposal.jsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../services/OrbService.js", import.meta.url), "utf8");
const orb = readFileSync(new URL("../../app/Orb.jsx", import.meta.url), "utf8");
const projectService = readFileSync(new URL("../../services/ProjectService.js", import.meta.url), "utf8");
const projectPage = readFileSync(new URL("../../app/ProjectPage.jsx", import.meta.url), "utf8");

test("proposal card exposes explicit confirm/cancel states and a supported task route", () => {
  for (const state of ["proposed", "executing", "completed", "cancelled", "expired", "failed"]) assert.match(component, new RegExp(state));
  assert.match(component, /Confirmar/);
  assert.match(component, /Cancelar/);
  assert.match(component, /\/proyectos\/\$\{display\.project_id\}\?tab=work&task=\$\{proposal\.result_entity_id\}/);
});

test("execution sends only proposal identity and hash, never business arguments", () => {
  assert.match(service, /confirm_orb_action_proposal/);
  assert.match(service, /target_proposal_id: proposalId/);
  assert.match(service, /expected_arguments_hash: argumentsHash/);
  assert.doesNotMatch(service, /confirm_orb_action_proposal[\s\S]{0,300}target_project_id/);
});

test("proposals recover from backend for both Orb surfaces", () => {
  assert.match(orb, /listOrbActionProposals\(activeConversationId\)/);
  assert.match(orb, /OrbActionProposal/);
  assert.match(orb, /export function OrbExperience/);
});

test("Actions V1 reuses the canonical project task contract and supported deep link", () => {
  assert.match(projectService, /create_project_task_with_configuration/);
  assert.match(projectPage, /searchParams\.get\("task"\)/);
  assert.match(projectPage, /tab === "work"/);
});
