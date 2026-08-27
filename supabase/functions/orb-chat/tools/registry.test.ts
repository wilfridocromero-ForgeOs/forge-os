import { executeOrbTool, getAuthorizedToolDefinitions } from "./registry.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Values differ");
  }
}

const denied = {
  projects: false,
  discovery: false,
  area_score: false,
  clients: false,
  calendar: false,
};

Deno.test("only authorized tools are offered", () => {
  const names = getAuthorizedToolDefinitions({ ...denied, projects: true }).map(
    (tool) => tool.name,
  );
  assertEquals(names, ["list_projects", "list_tasks", "get_project_summary"]);
});

Deno.test("registry exposes the seven bounded read tools for an administrator", () => {
  const tools = getAuthorizedToolDefinitions({
    projects: true,
    discovery: true,
    area_score: true,
    clients: true,
    calendar: true,
  });
  assertEquals(tools.map((tool) => tool.name), [
    "list_projects",
    "list_tasks",
    "get_project_summary",
    "list_discovery_assessments",
    "get_score_summary",
    "list_calendar_items",
    "list_clients",
  ]);
  for (const tool of tools) {
    const schema = tool.parameters as {
      additionalProperties?: boolean;
      properties?: Record<string, { maximum?: number }>;
    };
    assertEquals(schema.additionalProperties, false);
    if (schema.properties?.limit) {
      assertEquals(schema.properties.limit.maximum, 25);
    }
  }
});

Deno.test("unauthorized tool performs no query", async () => {
  let queried = false;
  const client = {
    from: () => {
      queried = true;
      throw new Error("unexpected");
    },
  };
  assertEquals(
    await executeOrbTool(
      {
        client: client as never,
        organizationId: "org",
        userId: "user",
        permissions: denied,
      },
      "list_projects",
      "{}",
    ),
    { status: "unauthorized" },
  );
  assertEquals(queried, false);
});

Deno.test("unknown tool is sanitized and performs no business query", async () => {
  let queried = false;
  const client = {
    from: () => {
      queried = true;
      throw new Error("unexpected");
    },
  };
  const result = await executeOrbTool(
    {
      client: client as never,
      organizationId: "org",
      userId: "user",
      permissions: { ...denied, projects: true },
    },
    "unknown_tool",
    "{}",
  );
  assertEquals(result, { status: "unauthorized" });
  assertEquals(queried, false);
});

Deno.test("handler failures return unavailable without leaking provider details", async () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "ilike"]) {
    chain[method] = () => chain;
  }
  chain.limit = () =>
    Promise.resolve({
      data: null,
      error: new Error("private database detail"),
    });
  const client = { from: () => chain };
  const result = await executeOrbTool(
    {
      client: client as never,
      organizationId: "org",
      userId: "user",
      permissions: { ...denied, projects: true },
    },
    "list_projects",
    JSON.stringify({ status: null, search: null, limit: 10 }),
  );
  assertEquals(result, { status: "unavailable" });
  assertEquals(
    JSON.stringify(result).includes("private database detail"),
    false,
  );
});

Deno.test("organization_id injection and excessive limits are rejected before query", async () => {
  let queried = false;
  const client = {
    from: () => {
      queried = true;
      throw new Error("unexpected");
    },
  };
  const permissions = { ...denied, projects: true };
  assertEquals(
    (await executeOrbTool(
      {
        client: client as never,
        organizationId: "org",
        userId: "user",
        permissions,
      },
      "list_projects",
      JSON.stringify({
        status: null,
        search: null,
        limit: 10,
        organization_id: "other",
      }),
    )).status,
    "invalid_arguments",
  );
  assertEquals(
    (await executeOrbTool(
      {
        client: client as never,
        organizationId: "org",
        userId: "user",
        permissions,
      },
      "list_projects",
      JSON.stringify({ status: null, search: null, limit: 26 }),
    )).status,
    "invalid_arguments",
  );
  assertEquals(queried, false);
});

Deno.test("invalid project id and oversized calendar range are rejected", async () => {
  const client = {
    from: () => {
      throw new Error("unexpected");
    },
  };
  const permissions = { ...denied, projects: true, calendar: true };
  assertEquals(
    (await executeOrbTool(
      {
        client: client as never,
        organizationId: "org",
        userId: "user",
        permissions,
      },
      "get_project_summary",
      '{"project_id":"bad"}',
    )).status,
    "invalid_arguments",
  );
  assertEquals(
    (await executeOrbTool(
      {
        client: client as never,
        organizationId: "org",
        userId: "user",
        permissions,
      },
      "list_calendar_items",
      JSON.stringify({
        start_at: "2026-01-01T00:00:00Z",
        end_at: "2026-03-01T00:00:00Z",
        limit: 10,
      }),
    )).status,
    "invalid_arguments",
  );
});
