import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildOrbRequestPayload } from "./orbSurfaceContext.js";
import { getOrbGlobalSurface, orbGlobalReducer } from "./orbGlobalState.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const ASSESSMENT_ID = "22222222-2222-4222-8222-222222222222";

test("launcher supports protected business surfaces and stays absent on Orb itself", () => {
  const expected = new Map([
    ["/", "dashboard"],
    ["/clientes", "clients"],
    ["/clientes/42", "client"],
    ["/proyectos", "projects"],
    [`/proyectos/${PROJECT_ID}`, "project"],
    ["/discovery", "discovery"],
    [`/discovery/evaluaciones/${ASSESSMENT_ID}`, "discovery"],
    [`/discovery/evaluaciones/${ASSESSMENT_ID}/resultado`, "discovery"],
    ["/orvesen-score", "score"],
    ["/calendario", "calendar"],
    ["/score-builder", "score_builder"],
    ["/discovery/builder", "discovery_builder"],
  ]);
  for (const [route, type] of expected) {
    assert.equal(getOrbGlobalSurface(route)?.type, type, route);
  }
  assert.equal(getOrbGlobalSurface("/orvesen-ia"), null);
  assert.equal(getOrbGlobalSurface("/ruta-desconocida"), null);
});

test("open and close preserve unrelated page state and never encode navigation", () => {
  const pageState = { route: "/score-builder", draft: "local", scrollY: 820 };
  const initial = { open: false, mounted: false, pageState };
  const opened = orbGlobalReducer(initial, { type: "open" });
  const closed = orbGlobalReducer(opened, { type: "close" });
  assert.equal(opened.open, true);
  assert.equal(opened.mounted, true);
  assert.equal(closed.open, false);
  assert.equal(closed.mounted, true);
  assert.equal(closed.pageState, pageState);
  assert.deepEqual(Object.keys(closed).sort(), ["mounted", "open", "pageState"]);
});

test("each turn payload receives only the current surface and no authority fields", () => {
  const clientSurface = getOrbGlobalSurface("/clientes/42");
  const projectSurface = getOrbGlobalSurface(`/proyectos/${PROJECT_ID}`);
  const first = buildOrbRequestPayload({
    conversationId: "conversation",
    clientMessageId: "message-1",
    message: "Cliente",
    surface: clientSurface,
  });
  const second = buildOrbRequestPayload({
    conversationId: "conversation",
    clientMessageId: "message-2",
    message: "Proyecto",
    surface: projectSurface,
  });
  assert.equal(first.surface.type, "client");
  assert.equal(second.surface.type, "project");
  for (const payload of [first, second]) {
    assert.equal("organization_id" in payload, false);
    assert.equal("role" in payload, false);
    assert.equal("permissions" in payload, false);
    assert.equal("tools" in payload, false);
  }
});

test("global shell is lazy, mounted outside AppLayout and does not create conversations", () => {
  const globalSource = readFileSync(new URL("./OrbGlobal.jsx", import.meta.url), "utf8");
  const protectedSource = readFileSync(new URL("../../routes/ProtectedRoute.jsx", import.meta.url), "utf8");
  assert.match(globalSource, /lazy\(\(\) =>/);
  assert.doesNotMatch(globalSource, /createOrbConversation|streamOrbMessage/);
  assert.match(globalSource, /event\.key === "Escape"/);
  assert.match(globalSource, /aria-modal="true"/);
  assert.match(protectedSource, /<OrbGlobal \/>/);
});
