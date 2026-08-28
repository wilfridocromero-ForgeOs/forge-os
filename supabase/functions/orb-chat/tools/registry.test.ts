import {
  createEntityResolutionSession,
  executeOrbTool,
  getAuthorizedToolDefinitions,
} from "./registry.ts";

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
  assertEquals(names, [
    "resolve_project",
    "prepare_create_project_task",
    "list_projects",
    "list_tasks",
    "get_project_summary",
  ]);
});

Deno.test("area_score controls whether score tools are offered", () => {
  const allowed = getAuthorizedToolDefinitions({
    ...denied,
    area_score: true,
  }).map((tool) => tool.name);
  const blocked = getAuthorizedToolDefinitions({
    ...denied,
    area_score: false,
  }).map((tool) => tool.name);
  assertEquals(allowed.includes("get_score_summary"), true);
  assertEquals(allowed.includes("get_score_breakdown"), true);
  assertEquals(blocked.includes("get_score_summary"), false);
  assertEquals(blocked.includes("get_score_breakdown"), false);
});

Deno.test("authorized get_score_summary is executable with user-scoped client", async () => {
  const snapshot = {
    id: "score-1",
    master_score: 80,
    performance_percentage: 80,
    coverage_percentage: 90,
    status: "partial",
    calculated_at: "2026-08-26T12:00:00.000Z",
  };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve({ data: snapshot, error: null });
  const client = { from: () => chain };
  assertEquals(
    await executeOrbTool(
      {
        client: client as never,
        organizationId: "org",
        userId: "user",
        permissions: { ...denied, area_score: true },
      },
      "get_score_summary",
      "{}",
    ),
    { status: "ok", data: { snapshot } },
  );
});

Deno.test("registry exposes the bounded read tools for an administrator", () => {
  const tools = getAuthorizedToolDefinitions({
    projects: true,
    discovery: true,
    area_score: true,
    clients: true,
    calendar: true,
  });
  assertEquals(tools.map((tool) => tool.name), [
    "resolve_project",
    "resolve_client",
    "prepare_create_project_task",
    "list_projects",
    "list_tasks",
    "get_project_summary",
    "list_discovery_assessments",
    "get_discovery_summary",
    "get_score_summary",
    "get_score_breakdown",
    "list_calendar_items",
    "list_clients",
    "get_client_summary",
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

Deno.test("OpenAI receives a proposal tool but no action executor", () => {
  const names = getAuthorizedToolDefinitions({ ...denied, projects: true }).map(
    (tool) => tool.name,
  );
  assertEquals(names.includes("prepare_create_project_task"), true);
  assertEquals(names.includes("confirm_orb_action_proposal"), false);
  assertEquals(names.includes("create_project_task_with_configuration"), false);
  assertEquals(
    names.some((name) => /confirm|execute|cancel/.test(name)),
    false,
  );
});

Deno.test("project resolver reads only organization-scoped RLS data and records only exact ids", async () => {
  const filters: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () =>
    Promise.resolve({
      data: [{ id: "project-1", name: "Pruebas para Orvesen" }],
      error: null,
    });
  const resolution = createEntityResolutionSession();
  const base = {
    client: { from: () => chain } as never,
    organizationId: "authorized-org",
    userId: "user",
    permissions: { ...denied, projects: true },
    resolution,
  };
  const typo = await executeOrbTool(
    base,
    "resolve_project",
    JSON.stringify({ name: "Pruebas par Orvesen" }),
  );
  assertEquals(typo.status, "ok");
  assertEquals(resolution.exactProjectIds.size, 0);
  const exact = await executeOrbTool(
    base,
    "resolve_project",
    JSON.stringify({ name: "Pruebas para Orvesen" }),
  );
  assertEquals(exact.status, "ok");
  assertEquals([...resolution.exactProjectIds], ["project-1"]);
  assertEquals(filters.includes(["organization_id", "authorized-org"]), false);
  assertEquals(
    filters.some(([column, value]) =>
      column === "organization_id" && value === "authorized-org"
    ),
    true,
  );
});

Deno.test("candidate, ambiguous and missing entities cannot prepare an action", async () => {
  let rpcCalled = false;
  const resolution = createEntityResolutionSession();
  const args = JSON.stringify({
    project_id: "33333333-3333-4333-8333-333333333333",
    title: "Task",
    instructions: null,
    assignee_id: null,
    priority: "medium",
    starts_at: null,
    due_at: null,
  });
  const result = await executeOrbTool(
    {
      client: {
        rpc: () => {
          rpcCalled = true;
        },
      } as never,
      organizationId: "org",
      userId: "user",
      conversationId: "11111111-1111-4111-8111-111111111111",
      userMessageId: "22222222-2222-4222-8222-222222222222",
      permissions: { ...denied, projects: true },
      resolution,
    },
    "prepare_create_project_task",
    args,
  );
  assertEquals(result, { status: "entity_not_resolved" });
  assertEquals(rpcCalled, false);
});

Deno.test("client resolver is permission-gated and organization-scoped", async () => {
  let queried = false;
  const deniedResult = await executeOrbTool(
    {
      client: {
        from: () => {
          queried = true;
        },
      } as never,
      organizationId: "org",
      userId: "user",
      permissions: denied,
      resolution: createEntityResolutionSession(),
    },
    "resolve_client",
    JSON.stringify({ name: "Acme" }),
  );
  assertEquals(deniedResult, { status: "unauthorized" });
  assertEquals(queried, false);

  const filters: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => Promise.resolve({ data: [], error: null });
  await executeOrbTool(
    {
      client: { from: () => chain } as never,
      organizationId: "authorized-org",
      userId: "user",
      permissions: { ...denied, clients: true },
      resolution: createEntityResolutionSession(),
    },
    "resolve_client",
    JSON.stringify({ name: "Cross Org Client" }),
  );
  assertEquals(
    filters.some(([column, value]) =>
      column === "organization_id" && value === "authorized-org"
    ),
    true,
  );
});

Deno.test("conversational entity confirmation still only prepares a proposal", async () => {
  const resolution = createEntityResolutionSession();
  resolution.exactProjectIds.add("33333333-3333-4333-8333-333333333333");
  const calls: string[] = [];
  const result = await executeOrbTool(
    {
      client: {
        rpc: (name: string) => {
          calls.push(name);
          return Promise.resolve({
            data: {
              id: "proposal",
              action_type: "create_project_task",
              status: "proposed",
              arguments_hash: "a".repeat(64),
              expires_at: "2026-08-28T04:00:00Z",
              display_payload: {},
            },
            error: null,
          });
        },
      } as never,
      organizationId: "org",
      userId: "user",
      conversationId: "11111111-1111-4111-8111-111111111111",
      userMessageId: "22222222-2222-4222-8222-222222222222",
      permissions: { ...denied, projects: true },
      resolution,
    },
    "prepare_create_project_task",
    JSON.stringify({
      project_id: "33333333-3333-4333-8333-333333333333",
      title: "Task",
      instructions: null,
      assignee_id: null,
      priority: "medium",
      starts_at: null,
      due_at: null,
    }),
  );
  assertEquals(result.status, "ok");
  assertEquals(calls, ["prepare_orb_project_task_proposal"]);
});

Deno.test("prepare task tool writes only through proposal RPC and reuses backend identity", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve({
        data: {
          id: "proposal",
          action_type: "create_project_task",
          status: "proposed",
          arguments_hash: "a".repeat(64),
          expires_at: "2026-08-28T04:00:00Z",
          display_payload: { project_name: "Project", title: "Task" },
        },
        error: null,
      });
    },
  };
  const result = await executeOrbTool(
    {
      client: client as never,
      organizationId: "server-org",
      userId: "user",
      conversationId: "11111111-1111-4111-8111-111111111111",
      userMessageId: "22222222-2222-4222-8222-222222222222",
      permissions: { ...denied, projects: true },
      resolution: {
        exactProjectIds: new Set(["33333333-3333-4333-8333-333333333333"]),
        exactClientIds: new Set(),
      },
    },
    "prepare_create_project_task",
    JSON.stringify({
      project_id: "33333333-3333-4333-8333-333333333333",
      title: "Task",
      instructions: null,
      assignee_id: null,
      priority: "medium",
      starts_at: null,
      due_at: null,
    }),
  );
  assertEquals(result.status, "ok");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "prepare_orb_project_task_proposal");
  assertEquals("organization_id" in calls[0].args, false);
});

Deno.test("prepare task rejects ambiguous dates and injected authority before RPC", async () => {
  let called = false;
  const client = {
    rpc: () => {
      called = true;
      throw new Error("unexpected");
    },
  };
  for (
    const args of [
      {
        project_id: "33333333-3333-4333-8333-333333333333",
        title: "Task",
        instructions: null,
        assignee_id: null,
        priority: "medium",
        starts_at: "2026-08-29T15:00:00",
        due_at: null,
      },
      {
        project_id: "33333333-3333-4333-8333-333333333333",
        title: "Task",
        instructions: null,
        assignee_id: null,
        priority: "medium",
        starts_at: null,
        due_at: null,
        organization_id: "other",
      },
    ]
  ) {
    const result = await executeOrbTool(
      {
        client: client as never,
        organizationId: "server-org",
        userId: "user",
        conversationId: "11111111-1111-4111-8111-111111111111",
        userMessageId: "22222222-2222-4222-8222-222222222222",
        permissions: { ...denied, projects: true },
        resolution: {
          exactProjectIds: new Set(["33333333-3333-4333-8333-333333333333"]),
          exactClientIds: new Set(),
        },
      },
      "prepare_create_project_task",
      JSON.stringify(args),
    );
    assertEquals(result.status, "invalid_arguments");
  }
  assertEquals(called, false);
});

Deno.test("client summary uses bigint identity, organization scope and excludes PII", async () => {
  const selected: string[] = [];
  const filters: Array<[string, string, unknown]> = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.select = (columns: string) => {
        selected.push(`${table}:${columns}`);
        return chain;
      };
      chain.eq = (column: string, value: unknown) => {
        filters.push([table, column, value]);
        return chain;
      };
      chain.order = () => chain;
      chain.limit = () =>
        Promise.resolve({
          data: table === "projects"
            ? [{ id: "project", name: "Project", status: "active" }]
            : [{ id: "assessment", status: "completed", score: 80 }],
          error: null,
        });
      chain.maybeSingle = () =>
        Promise.resolve({
          data: {
            id: 42,
            company_name: "Client",
            industry: "Technology",
            status: "active",
            created_at: "2026-01-01T00:00:00Z",
          },
          error: null,
        });
      return chain;
    },
  };
  const result = await executeOrbTool(
    {
      client: client as never,
      organizationId: "org",
      userId: "member",
      permissions: { ...denied, clients: true },
    },
    "get_client_summary",
    JSON.stringify({ client_id: 42 }),
  );
  assertEquals(result.status, "ok");
  assertEquals(
    filters.some(([table, column, value]) =>
      table === "clients" && column === "organization_id" && value === "org"
    ),
    true,
  );
  const contract = selected.join("|");
  for (
    const excluded of ["email", "phone", "contact_name", "notes", "content"]
  ) {
    assertEquals(contract.includes(excluded), false);
  }
});

Deno.test("client summary rejects invalid ids, extra fields and unauthorized access before query", async () => {
  let queried = false;
  const client = {
    from: () => {
      queried = true;
      throw new Error("unexpected");
    },
  };
  for (
    const [permissions, args] of [
      [{ ...denied, clients: true }, { client_id: "uuid" }],
      [{ ...denied, clients: true }, {
        client_id: 42,
        organization_id: "other",
      }],
      [denied, { client_id: 42 }],
    ] as const
  ) {
    const result = await executeOrbTool(
      {
        client: client as never,
        organizationId: "org",
        userId: "user",
        permissions,
      },
      "get_client_summary",
      JSON.stringify(args),
    );
    assertEquals(
      ["invalid_arguments", "unauthorized"].includes(result.status),
      true,
    );
  }
  assertEquals(queried, false);
});

Deno.test("cross-organization client id is indistinguishable from missing", async () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  const result = await executeOrbTool(
    {
      client: { from: () => chain } as never,
      organizationId: "org",
      userId: "user",
      permissions: { ...denied, clients: true },
    },
    "get_client_summary",
    JSON.stringify({ client_id: 42 }),
  );
  assertEquals(result, { status: "ok", data: { status: "not_found" } });
});

Deno.test("discovery summary returns aggregates without querying responses", async () => {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order"]) {
        chain[method] = () => chain;
      }
      chain.limit = () =>
        Promise.resolve({
          data: [{
            category_id: "category",
            percentage: 35,
            status: "critical",
            category: { id: "category", name: "Area" },
          }],
          error: null,
        });
      chain.maybeSingle = () =>
        Promise.resolve({
          data: {
            id: "assessment",
            status: "completed",
            score: 35,
            max_score: 100,
          },
          error: null,
        });
      return chain;
    },
  };
  const result = await executeOrbTool(
    {
      client: client as never,
      organizationId: "org",
      userId: "user",
      permissions: { ...denied, discovery: true },
    },
    "get_discovery_summary",
    JSON.stringify({ assessment_id: "11111111-1111-4111-8111-111111111111" }),
  );
  assertEquals(result.status, "ok");
  assertEquals(tables.includes("discovery_responses"), false);
  assertEquals(tables, ["discovery_assessments", "discovery_category_results"]);
});

Deno.test("discovery summary rejects invalid, unauthorized and cross-organization assessments safely", async () => {
  let queried = false;
  const noQueryClient = {
    from: () => {
      queried = true;
      throw new Error("unexpected");
    },
  };
  for (
    const [permissions, assessmentId] of [
      [{ ...denied, discovery: true }, "bad"],
      [denied, "11111111-1111-4111-8111-111111111111"],
    ] as const
  ) {
    const result = await executeOrbTool(
      {
        client: noQueryClient as never,
        organizationId: "org",
        userId: "user",
        permissions,
      },
      "get_discovery_summary",
      JSON.stringify({ assessment_id: assessmentId }),
    );
    assertEquals(
      ["invalid_arguments", "unauthorized"].includes(result.status),
      true,
    );
  }
  assertEquals(queried, false);

  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  const crossOrg = await executeOrbTool(
    {
      client: { from: () => chain } as never,
      organizationId: "org",
      userId: "user",
      permissions: { ...denied, discovery: true },
    },
    "get_discovery_summary",
    JSON.stringify({
      assessment_id: "11111111-1111-4111-8111-111111111111",
    }),
  );
  assertEquals(crossOrg, { status: "ok", data: { status: "not_found" } });
});

Deno.test("score breakdown reads canonical snapshots and never calculates an alternative", async () => {
  const tables: string[] = [];
  const client = {
    from(table: string) {
      tables.push(table);
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order"]) {
        chain[method] = () => chain;
      }
      chain.limit = () =>
        table === "company_score_snapshots"
          ? chain
          : Promise.resolve({ data: [], error: null });
      chain.maybeSingle = () =>
        Promise.resolve({
          data: { id: "snapshot", master_score: 700 },
          error: null,
        });
      return chain;
    },
  };
  const result = await executeOrbTool(
    {
      client: client as never,
      organizationId: "org",
      userId: "user",
      permissions: { ...denied, area_score: true },
    },
    "get_score_breakdown",
    "{}",
  );
  assertEquals(result.status, "ok");
  assertEquals(tables, [
    "company_score_snapshots",
    "company_score_snapshot_components",
  ]);
});

Deno.test("score breakdown denial executes no query", async () => {
  let queried = false;
  const result = await executeOrbTool(
    {
      client: {
        from: () => {
          queried = true;
          throw new Error("unexpected");
        },
      } as never,
      organizationId: "org",
      userId: "user",
      permissions: denied,
    },
    "get_score_breakdown",
    "{}",
  );
  assertEquals(result, { status: "unauthorized" });
  assertEquals(queried, false);
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

Deno.test("a cross-organization project id reveals only not_found", async () => {
  const filters: Array<[string, string, unknown]> = [];
  const client = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (column: string, value: unknown) => {
        filters.push([table, column, value]);
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve(resolve({ data: [], error: null }));
      return chain;
    },
  };
  const projectId = "11111111-1111-4111-8111-111111111111";
  assertEquals(
    await executeOrbTool(
      {
        client: client as never,
        organizationId: "authorized-organization",
        userId: "user",
        permissions: { ...denied, projects: true },
      },
      "get_project_summary",
      JSON.stringify({ project_id: projectId }),
    ),
    { status: "ok", data: { status: "not_found" } },
  );
  assertEquals(
    filters.some(([table, column, value]) =>
      table === "projects" && column === "organization_id" &&
      value === "authorized-organization"
    ),
    true,
  );
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
