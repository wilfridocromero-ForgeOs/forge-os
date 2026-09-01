import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrbDestination,
  buildOrbRequestPayload,
  deriveOrbSurfaceContext,
  deriveOrbSurfaceFromSearch,
} from "./orbSurfaceContext.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "42";
const ASSESSMENT_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const BUILDER_NODE_ID = "55555555-5555-4555-8555-555555555555";
const BUILDER_ASSET_ID = "66666666-6666-4666-8666-666666666666";

test("derives all supported ORVESEN surfaces from real routes", () => {
  assert.deepEqual(deriveOrbSurfaceContext("/"), { type: "dashboard", route: "/" });
  assert.deepEqual(deriveOrbSurfaceContext("/orvesen-ia"), { type: "orvesen_ai", route: "/orvesen-ia" });
  assert.deepEqual(deriveOrbSurfaceContext(`/proyectos/${PROJECT_ID}`), { type: "project", route: `/proyectos/${PROJECT_ID}`, entity_id: PROJECT_ID });
  assert.deepEqual(deriveOrbSurfaceContext(`/clientes/${CLIENT_ID}`), { type: "client", route: `/clientes/${CLIENT_ID}`, entity_id: CLIENT_ID });
  assert.deepEqual(deriveOrbSurfaceContext("/clientes"), { type: "clients", route: "/clientes" });
  assert.deepEqual(deriveOrbSurfaceContext("/discovery"), { type: "discovery", route: "/discovery" });
  assert.deepEqual(deriveOrbSurfaceContext(`/discovery/evaluaciones/${ASSESSMENT_ID}`), { type: "discovery", route: `/discovery/evaluaciones/${ASSESSMENT_ID}`, entity_id: ASSESSMENT_ID });
  assert.deepEqual(deriveOrbSurfaceContext(`/discovery/evaluaciones/${ASSESSMENT_ID}/resultado`), { type: "discovery", route: `/discovery/evaluaciones/${ASSESSMENT_ID}/resultado`, entity_id: ASSESSMENT_ID });
  assert.deepEqual(deriveOrbSurfaceContext("/orvesen-score"), { type: "score", route: "/orvesen-score" });
  assert.deepEqual(deriveOrbSurfaceContext("/business-score"), { type: "score", route: "/business-score" });
  assert.deepEqual(deriveOrbSurfaceContext("/calendario"), { type: "calendar", route: "/calendario" });
  assert.deepEqual(deriveOrbSurfaceContext("/score-builder"), { type: "score_builder", route: "/score-builder" });
  assert.deepEqual(deriveOrbSurfaceContext("/discovery/builder"), { type: "discovery_builder", route: "/discovery/builder" });
});

test("preserves a valid task workspace hint without treating it as authority", () => {
  assert.deepEqual(
    deriveOrbSurfaceContext(`/proyectos/${PROJECT_ID}`, new URLSearchParams(`tab=work&task=${TASK_ID}`)),
    { type: "project", route: `/proyectos/${PROJECT_ID}`, entity_id: PROJECT_ID, task_id: TASK_ID },
  );
  assert.deepEqual(
    deriveOrbSurfaceContext(`/proyectos/${PROJECT_ID}`, new URLSearchParams("tab=work&task=malicious")),
    { type: "project", route: `/proyectos/${PROJECT_ID}`, entity_id: PROJECT_ID },
  );
  assert.equal(
    buildOrbDestination(`/proyectos/${PROJECT_ID}`, `?tab=work&task=${TASK_ID}`),
    `/orvesen-ia?from=${encodeURIComponent(`/proyectos/${PROJECT_ID}?tab=work&task=${TASK_ID}`)}`,
  );
  assert.deepEqual(
    deriveOrbSurfaceFromSearch(new URLSearchParams(`from=${encodeURIComponent(`/proyectos/${PROJECT_ID}?tab=work&task=${TASK_ID}`)}`)),
    { type: "project", route: `/proyectos/${PROJECT_ID}`, entity_id: PROJECT_ID, task_id: TASK_ID },
  );
});

test("keeps requests without Surface Context backward compatible", () => {
  assert.deepEqual(buildOrbRequestPayload({ conversationId: "conversation", clientMessageId: "message", message: "Hola" }), {
    conversation_id: "conversation",
    client_message_id: "message",
    message: "Hola",
  });
});

test("derives Builder system and selected-node hints", () => {
  assert.deepEqual(deriveOrbSurfaceContext(`/construir/sistemas/${PROJECT_ID}`, new URLSearchParams(`node=${BUILDER_NODE_ID}&asset=${BUILDER_ASSET_ID}`)), { type: "builder_system", route: `/construir/sistemas/${PROJECT_ID}`, entity_id: PROJECT_ID, node_id: BUILDER_NODE_ID, asset_id: BUILDER_ASSET_ID });
  assert.equal(deriveOrbSurfaceContext("/construir/sistemas/not-a-uuid"), null);
});

test("derives typed Builder asset hints without treating them as authorization", () => {
  assert.deepEqual(deriveOrbSurfaceContext(`/construir/assets/landing_page/${BUILDER_ASSET_ID}`), { type: "builder_asset", route: `/construir/assets/landing_page/${BUILDER_ASSET_ID}`, entity_id: BUILDER_ASSET_ID, asset_type: "landing_page" });
  assert.equal(deriveOrbSurfaceContext(`/construir/assets/store/${BUILDER_ASSET_ID}`), null);
});

test("sends the browser IANA timezone without authority fields", () => {
  assert.deepEqual(buildOrbRequestPayload({ conversationId: "conversation", clientMessageId: "message", message: "Crea una tarea para mañana", timezone: "America/La_Paz" }), {
    conversation_id: "conversation",
    client_message_id: "message",
    message: "Crea una tarea para mañana",
    timezone: "America/La_Paz",
  });
});

test("rejects unknown routes and invalid entity ids", () => {
  assert.deepEqual(deriveOrbSurfaceContext("/configuracion"), { type: "settings", route: "/configuracion" });
  assert.equal(deriveOrbSurfaceContext("/desconocido"), null);
  assert.equal(deriveOrbSurfaceContext("/proyectos/not-a-uuid"), null);
  assert.equal(deriveOrbSurfaceContext("/clientes/not-a-uuid"), null);
  assert.equal(deriveOrbSurfaceContext("/clientes/0"), null);
  assert.equal(deriveOrbSurfaceContext("/discovery/evaluaciones/not-a-uuid"), null);
});

test("preserves the source route in the Orb destination", () => {
  assert.equal(buildOrbDestination(`/proyectos/${PROJECT_ID}`), `/orvesen-ia?from=${encodeURIComponent(`/proyectos/${PROJECT_ID}`)}`);
  assert.equal(buildOrbDestination("/orvesen-ia"), "/orvesen-ia");
  assert.equal(buildOrbDestination("/configuracion"), "/orvesen-ia?from=%2Fconfiguracion");
});

test("derives legacy Dashboard and defaults direct Orb to orvesen_ai", () => {
  assert.deepEqual(deriveOrbSurfaceFromSearch(new URLSearchParams("from=dashboard")), { type: "dashboard", route: "/" });
  assert.deepEqual(deriveOrbSurfaceFromSearch(new URLSearchParams()), { type: "orvesen_ai", route: "/orvesen-ia" });
});
