import {
  entityNameSimilarity,
  normalizeEntityName,
  readTerminalEntityResolution,
  resolveEntityName,
} from "./entityResolution.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Values differ: ${JSON.stringify(actual)} !== ${
        JSON.stringify(expected)
      }`,
    );
  }
}

const project = { id: "project-1", name: "Pruebas para Orvesen" };

Deno.test("project exact and normalized exact retain authorized identity", () => {
  assertEquals(resolveEntityName("Pruebas para Orvesen", [project]), {
    state: "EXACT",
    entity: project,
  });
  assertEquals(resolveEntityName("  PRUEBAS   PARA ORVESEN ", [project]), {
    state: "EXACT",
    entity: project,
  });
  assertEquals(normalizeEntityName("Ácme,  S.A."), "acme s a");
});

Deno.test("small project typo yields one name-only candidate", () => {
  assertEquals(resolveEntityName("Pruebas par Orvesen", [project]), {
    state: "UNIQUE_CANDIDATE",
    requested: "Pruebas par Orvesen",
    candidates: [{ name: "Pruebas para Orvesen" }],
  });
});

Deno.test("similar authorized names are ambiguous and bounded", () => {
  const result = resolveEntityName("Acme Grup", [
    { id: "one", name: "Acme Group" },
    { id: "two", name: "Acme Grupo" },
    { id: "three", name: "Acme Grup A" },
    { id: "four", name: "Acme Grup B" },
  ]);
  assertEquals(result.state, "AMBIGUOUS");
  assertEquals("candidates" in result ? result.candidates.length : 0, 3);
});

Deno.test("weak names are not promoted to candidates", () => {
  assertEquals(resolveEntityName("Proyecto lunar inexistente", [project]), {
    state: "NOT_FOUND",
    requested: "Proyecto lunar inexistente",
    candidates: [],
  });
  assertEquals(entityNameSimilarity("lunar", project.name) < 0.72, true);
});

Deno.test("projects outside the authorized result set can never be candidates", () => {
  assertEquals(
    resolveEntityName("Proyecto secreto", [project]).state,
    "NOT_FOUND",
  );
});

Deno.test("clients use the same exact typo ambiguous and not-found contract", () => {
  const clients = [{ id: 1, name: "Acme Group" }];
  assertEquals(resolveEntityName("Acme Group", clients).state, "EXACT");
  assertEquals(
    resolveEntityName("Acme Grou", clients).state,
    "UNIQUE_CANDIDATE",
  );
  assertEquals(
    resolveEntityName("Acme Grup", [
      ...clients,
      { id: 2, name: "Acme Grupo" },
    ]).state,
    "AMBIGUOUS",
  );
  assertEquals(resolveEntityName("Cliente lunar", clients).state, "NOT_FOUND");
});

Deno.test("terminal clarifications expose names but never candidate ids", () => {
  const output = {
    status: "ok",
    data: {
      entity_type: "project",
      resolution: resolveEntityName("Pruebas par Orvesen", [project]),
    },
  };
  const message = readTerminalEntityResolution(output) || "";
  assertEquals(message.includes("Pruebas para Orvesen"), true);
  assertEquals(message.includes("project-1"), false);
});
