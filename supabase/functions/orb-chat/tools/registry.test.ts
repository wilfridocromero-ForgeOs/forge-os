import {
  contextualTaskResolutionArguments,
  contextualTaskResolutionCall,
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

function emptyPendingQuery() {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "gt"]) {
    chain[method] = () => chain;
  }
  chain.limit = () => Promise.resolve({ data: [], error: null });
  return chain;
}

Deno.test("only authorized tools are offered", () => {
  const names = getAuthorizedToolDefinitions({ ...denied, projects: true }).map(
    (tool) => tool.name,
  );
  assertEquals(names, [
    "resolve_task",
    "resolve_project",
    "resolve_project_assignee",
    "resolve_task_date",
    "prepare_create_project_task",
    "prepare_update_project_task",
    "prepare_change_project_task_status",
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
    "resolve_task",
    "resolve_project",
    "resolve_client",
    "resolve_project_assignee",
    "resolve_task_date",
    "prepare_create_project_task",
    "prepare_update_project_task",
    "prepare_change_project_task_status",
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

Deno.test("update tool keeps a strict compatible schema and backend duplicate authority", async () => {
  const tool = getAuthorizedToolDefinitions({ ...denied, projects: true })
    .find((candidate) => candidate.name === "prepare_update_project_task");
  const schema = tool?.parameters as {
    required?: string[];
    properties?: Record<string, Record<string, unknown>>;
  };
  assertEquals(tool?.strict, true);
  assertEquals(schema.required, [
    "task_id",
    "change_fields",
    "title",
    "instructions",
    "assignee_id",
    "priority",
    "due_at",
  ]);
  assertEquals(
    "uniqueItems" in (schema.properties?.change_fields || {}),
    false,
  );

  let rpcCalled = false;
  const taskId = "55555555-5555-4555-8555-555555555555";
  const resolution = createEntityResolutionSession();
  resolution.exactTaskIds.add(taskId);
  const base = {
    client: {
      from: () => emptyPendingQuery(),
      rpc: () => {
        rpcCalled = true;
        return Promise.resolve({ data: null, error: null });
      },
    } as never,
    organizationId: "org",
    userId: "user",
    conversationId: "11111111-1111-4111-8111-111111111111",
    userMessageId: "22222222-2222-4222-8222-222222222222",
    permissions: { ...denied, projects: true },
    resolution,
  };
  const duplicate = await executeOrbTool(
    base,
    tool!.name,
    JSON.stringify({
      task_id: taskId,
      change_fields: ["priority", "priority"],
      title: null,
      instructions: null,
      assignee_id: null,
      priority: "high",
      due_at: null,
    }),
  );
  const unknown = await executeOrbTool(
    base,
    tool!.name,
    JSON.stringify({
      task_id: taskId,
      change_fields: ["status"],
      title: null,
      instructions: null,
      assignee_id: null,
      priority: null,
      due_at: null,
    }),
  );
  assertEquals(duplicate, { status: "invalid_arguments" });
  assertEquals(unknown, { status: "invalid_arguments" });
  assertEquals(rpcCalled, false);
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

Deno.test("task resolver authorizes only exact visible tasks and binds their project", async () => {
  const taskId = "55555555-5555-4555-8555-555555555555";
  const projectId = "33333333-3333-4333-8333-333333333333";
  const filters: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return chain;
  };
  chain.neq = () => chain;
  chain.order = () => chain;
  const response = {
    data: [{ id: taskId, project_id: projectId, title: "Revisar Discovery" }],
    error: null,
  };
  chain.limit = () => chain;
  chain.then = (resolve: (value: typeof response) => unknown) =>
    Promise.resolve(response).then(resolve);
  const resolution = createEntityResolutionSession();
  const result = await executeOrbTool(
    {
      client: { from: () => chain } as never,
      organizationId: "authorized-org",
      userId: "user",
      permissions: { ...denied, projects: true },
      resolution,
      surface: {
        type: "project",
        route: `/proyectos/${projectId}`,
        entity_id: projectId,
        task_id: taskId,
      },
    },
    "resolve_task",
    JSON.stringify({ task_id: taskId, project_id: projectId, name: null }),
  );
  assertEquals(result.status, "ok");
  assertEquals(resolution.exactTaskIds.has(taskId), true);
  assertEquals(resolution.exactTaskProjectIds.get(taskId), projectId);
  assertEquals(resolution.exactProjectIds.has(projectId), true);
  assertEquals(
    filters.some(([column, value]) =>
      column === "project.organization_id" && value === "authorized-org"
    ),
    true,
  );
});

Deno.test("deictic task requests deterministically prefer the contextual id", () => {
  const projectId = "33333333-3333-4333-8333-333333333333";
  const taskId = "55555555-5555-4555-8555-555555555555";
  const result = contextualTaskResolutionArguments(
    "resolve_task",
    JSON.stringify({
      task_id: null,
      project_id: projectId,
      name: "Activar notificaciones",
    }),
    "Pásale esta tarea a Joseph para mañana.",
    {
      type: "project",
      route: `/proyectos/${projectId}`,
      entity_id: projectId,
      task_id: taskId,
    },
  );
  assertEquals(JSON.parse(result), {
    task_id: taskId,
    project_id: projectId,
    name: null,
  });
  assertEquals(
    contextualTaskResolutionCall(
      "Pásale esta tarea a Joseph para mañana y ponla en prioridad alta.",
      {
        type: "project",
        route: `/proyectos/${projectId}`,
        entity_id: projectId,
        task_id: taskId,
      },
    ),
    JSON.stringify({ task_id: taskId, project_id: projectId, name: null }),
  );
});

Deno.test("non-deictic task names remain nominal outside and inside task surfaces", () => {
  const raw = JSON.stringify({
    task_id: null,
    project_id: null,
    name: "Activar notificaciones",
  });
  assertEquals(
    contextualTaskResolutionArguments(
      "resolve_task",
      raw,
      "Actualiza Activar notificaciones",
      null,
    ),
    raw,
  );
  assertEquals(
    contextualTaskResolutionArguments(
      "resolve_task",
      raw,
      "Actualiza la tarea Activar notificaciones",
      {
        type: "project",
        route: "/proyectos/33333333-3333-4333-8333-333333333333",
        entity_id: "33333333-3333-4333-8333-333333333333",
        task_id: "55555555-5555-4555-8555-555555555555",
      },
    ),
    raw,
  );
});

Deno.test("a manipulated task surface is rejected before a business query", async () => {
  let queried = false;
  const result = await executeOrbTool(
    {
      client: {
        from: () => {
          queried = true;
          return {};
        },
      } as never,
      organizationId: "org",
      userId: "user",
      permissions: { ...denied, projects: true },
      resolution: createEntityResolutionSession(),
      surface: {
        type: "project",
        route: "/proyectos/33333333-3333-4333-8333-333333333333",
        entity_id: "33333333-3333-4333-8333-333333333333",
        task_id: "55555555-5555-4555-8555-555555555555",
      },
    },
    "resolve_task",
    JSON.stringify({
      task_id: "66666666-6666-4666-8666-666666666666",
      project_id: "33333333-3333-4333-8333-333333333333",
      name: null,
    }),
  );
  assertEquals(result, { status: "entity_not_resolved" });
  assertEquals(queried, false);
});

Deno.test("task fuzzy candidates never become executable identities", async () => {
  const projectId = "33333333-3333-4333-8333-333333333333";
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "order"]) {
    chain[method] = () => chain;
  }
  const response = {
    data: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        project_id: projectId,
        title: "Revisar Discovery",
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        project_id: projectId,
        title: "Revisar Discovery final",
      },
    ],
    error: null,
  };
  chain.limit = () => chain;
  chain.then = (resolve: (value: typeof response) => unknown) =>
    Promise.resolve(response).then(resolve);
  const resolution = createEntityResolutionSession();
  const result = await executeOrbTool(
    {
      client: { from: () => chain } as never,
      organizationId: "org",
      userId: "user",
      permissions: { ...denied, projects: true },
      resolution,
    },
    "resolve_task",
    JSON.stringify({
      task_id: null,
      project_id: projectId,
      name: "Revisar Discoveri",
    }),
  ) as { status: string; data?: { resolution?: { state?: string } } };
  assertEquals(result.status, "ok");
  assertEquals(
    ["UNIQUE_CANDIDATE", "AMBIGUOUS"].includes(
      result.data?.resolution?.state || "",
    ),
    true,
  );
  assertEquals(resolution.exactTaskIds.size, 0);
});

Deno.test("duplicate task names remain ambiguous with safe distinguishable metadata", async () => {
  const projectId = "33333333-3333-4333-8333-333333333333";
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "order"]) {
    chain[method] = () => chain;
  }
  const response = {
    data: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        project_id: projectId,
        title: "Activar notificaciones",
        status: "completed",
        due_at: "2026-08-22T14:44:00Z",
        project: { name: "Pruebas para Orvesen" },
      },
      {
        id: "66666666-6666-4666-8666-666666666666",
        project_id: projectId,
        title: "Activar notificaciones",
        status: "pending",
        due_at: "2026-08-22T14:46:00Z",
        project: { name: "Pruebas para Orvesen" },
      },
    ],
    error: null,
  };
  chain.limit = () => chain;
  chain.then = (resolve: (value: typeof response) => unknown) =>
    Promise.resolve(response).then(resolve);
  const result = await executeOrbTool(
    {
      client: { from: () => chain } as never,
      organizationId: "org",
      userId: "user",
      permissions: { ...denied, projects: true },
      resolution: createEntityResolutionSession(),
    },
    "resolve_task",
    JSON.stringify({
      task_id: null,
      project_id: projectId,
      name: "Activar notificaciones",
    }),
  );
  const data = result.data as {
    resolution: { state: string; candidates: Array<{ name: string }> };
  };
  assertEquals(data.resolution.state, "AMBIGUOUS");
  assertEquals(data.resolution.candidates.length, 2);
  assertEquals(data.resolution.candidates[0].name.includes("completed"), true);
  assertEquals(data.resolution.candidates[1].name.includes("pending"), true);
  assertEquals(JSON.stringify(data).includes("55555555"), false);
  assertEquals(JSON.stringify(data).includes("66666666"), false);
});

Deno.test("missing or cross-organization tasks remain indistinguishable", async () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "order"]) {
    chain[method] = () => chain;
  }
  const response = { data: [], error: null };
  chain.limit = () => chain;
  chain.then = (resolve: (value: typeof response) => unknown) =>
    Promise.resolve(response).then(resolve);
  const result = await executeOrbTool(
    {
      client: { from: () => chain } as never,
      organizationId: "org",
      userId: "user",
      permissions: { ...denied, projects: true },
      resolution: createEntityResolutionSession(),
    },
    "resolve_task",
    JSON.stringify({
      task_id: "55555555-5555-4555-8555-555555555555",
      project_id: null,
      name: null,
    }),
  );
  assertEquals(result, {
    status: "ok",
    data: {
      entity_type: "task",
      resolution: {
        state: "NOT_FOUND",
        requested: "esta tarea",
        candidates: [],
      },
    },
  });
});

Deno.test("task update and status tools only prepare persisted proposals", async () => {
  const taskId = "55555555-5555-4555-8555-555555555555";
  const projectId = "33333333-3333-4333-8333-333333333333";
  const calls: Array<[string, Record<string, unknown>]> = [];
  const resolution = createEntityResolutionSession();
  resolution.exactTaskIds.add(taskId);
  resolution.exactTaskProjectIds.set(taskId, projectId);
  const client = {
    from: () => emptyPendingQuery(),
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      return Promise.resolve({
        data: {
          id: "proposal",
          action_type: name.includes("status")
            ? "change_project_task_status"
            : "update_project_task",
          status: "proposed",
          arguments_hash: "a".repeat(64),
          expires_at: "2026-08-29T12:00:00Z",
          display_payload: {},
        },
        error: null,
      });
    },
  };
  const base = {
    client: client as never,
    organizationId: "org",
    userId: "user",
    conversationId: "11111111-1111-4111-8111-111111111111",
    userMessageId: "22222222-2222-4222-8222-222222222222",
    permissions: { ...denied, projects: true },
    resolution,
    now: new Date("2026-08-29T10:00:00Z"),
  };
  const update = await executeOrbTool(
    base,
    "prepare_update_project_task",
    JSON.stringify({
      task_id: taskId,
      change_fields: ["priority"],
      title: null,
      instructions: null,
      assignee_id: null,
      priority: "high",
      due_at: null,
    }),
  );
  const status = await executeOrbTool(
    base,
    "prepare_change_project_task_status",
    JSON.stringify({ task_id: taskId, target_status: "in_progress" }),
  );
  assertEquals(update.status, "ok");
  assertEquals(status.status, "ok");
  assertEquals(calls.map(([name]) => name), [
    "prepare_orb_update_project_task_proposal",
    "prepare_orb_task_status_proposal",
  ]);
  assertEquals(calls[0][1].requested_changes, { priority: "high" });
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

Deno.test("assignee resolution is project-scoped and excludes observer roles", async () => {
  const filters: Array<[string, unknown]> = [];
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (column: string, value: unknown) => {
    filters.push([column, value]);
    return chain;
  };
  chain.in = (column: string, value: unknown) => {
    filters.push([column, value]);
    return chain;
  };
  chain.limit = () =>
    Promise.resolve({
      data: [{
        user_id: "44444444-4444-4444-8444-444444444444",
        role: "member",
        user: {
          id: "44444444-4444-4444-8444-444444444444",
          first_name: "Roberto",
        },
      }],
      error: null,
    });
  const resolution = createEntityResolutionSession();
  resolution.exactProjectIds.add("33333333-3333-4333-8333-333333333333");
  const result = await executeOrbTool(
    {
      client: { from: () => chain } as never,
      organizationId: "org",
      userId: "user",
      permissions: { ...denied, projects: true },
      resolution,
    },
    "resolve_project_assignee",
    JSON.stringify({
      project_id: "33333333-3333-4333-8333-333333333333",
      name: "Roberto",
    }),
  );
  assertEquals(result.status, "ok");
  assertEquals(
    filters.some(([column, value]) =>
      column === "project_id" &&
      value === "33333333-3333-4333-8333-333333333333"
    ),
    true,
  );
  assertEquals(
    JSON.stringify(filters).includes('"role",["owner","member"]'),
    true,
  );
  assertEquals(
    resolution.exactAssigneeIds?.get("33333333-3333-4333-8333-333333333333")
      ?.has("44444444-4444-4444-8444-444444444444"),
    true,
  );
});

Deno.test("prepare rejects an assignee not exactly resolved for that project", async () => {
  let rpcCalled = false;
  const resolution = createEntityResolutionSession();
  resolution.exactProjectIds.add("33333333-3333-4333-8333-333333333333");
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
    JSON.stringify({
      project_id: "33333333-3333-4333-8333-333333333333",
      title: "Task",
      instructions: null,
      assignee_id: "44444444-4444-4444-8444-444444444444",
      priority: null,
      starts_at: null,
      due_at: null,
    }),
  );
  assertEquals(result, { status: "entity_not_resolved" });
  assertEquals(rpcCalled, false);
});

Deno.test("prepare accepts only dates produced by the trusted temporal resolver", async () => {
  const resolution = createEntityResolutionSession();
  resolution.exactProjectIds.add("33333333-3333-4333-8333-333333333333");
  const client = {
    from: () => emptyPendingQuery(),
    rpc: () =>
      Promise.resolve({
        data: {
          id: "proposal",
          action_type: "create_project_task",
          status: "proposed",
          arguments_hash: "a".repeat(64),
          expires_at: "2026-08-29T00:00:00Z",
          display_payload: {},
        },
        error: null,
      }),
  };
  const base = {
    client: client as never,
    organizationId: "org",
    userId: "user",
    conversationId: "11111111-1111-4111-8111-111111111111",
    userMessageId: "22222222-2222-4222-8222-222222222222",
    permissions: { ...denied, projects: true },
    resolution,
    timezone: "America/La_Paz",
    now: new Date("2026-08-28T14:00:00Z"),
  };
  const date = await executeOrbTool(
    base,
    "resolve_task_date",
    JSON.stringify({ phrase: "mañana", field: "due_at" }),
  ) as { data: { value: string } };
  const accepted = await executeOrbTool(
    base,
    "prepare_create_project_task",
    JSON.stringify({
      project_id: "33333333-3333-4333-8333-333333333333",
      title: "Task",
      instructions: null,
      assignee_id: null,
      priority: null,
      starts_at: null,
      due_at: date.data.value,
    }),
  );
  assertEquals(accepted.status, "ok");
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
        from: () => emptyPendingQuery(),
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
      priority: null,
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
    from: () => emptyPendingQuery(),
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
      priority: null,
      starts_at: null,
      due_at: null,
    }),
  );
  assertEquals(result.status, "ok");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "prepare_orb_project_task_proposal");
  assertEquals(calls[0].args.requested_priority, "medium");
  assertEquals("organization_id" in calls[0].args, false);
});

Deno.test("a pending proposal blocks a materially new proposal without mutation", async () => {
  let rpcCalled = false;
  const chain = emptyPendingQuery();
  chain.limit = () =>
    Promise.resolve({ data: [{ id: "old-proposal" }], error: null });
  const resolution = createEntityResolutionSession();
  resolution.exactProjectIds.add("33333333-3333-4333-8333-333333333333");
  const result = await executeOrbTool(
    {
      client: {
        from: () => chain,
        rpc: () => {
          rpcCalled = true;
        },
      } as never,
      organizationId: "org",
      userId: "user",
      conversationId: "11111111-1111-4111-8111-111111111111",
      userMessageId: "55555555-5555-4555-8555-555555555555",
      permissions: { ...denied, projects: true },
      resolution,
    },
    "prepare_create_project_task",
    JSON.stringify({
      project_id: "33333333-3333-4333-8333-333333333333",
      title: "Changed task",
      instructions: null,
      assignee_id: null,
      priority: null,
      starts_at: null,
      due_at: null,
    }),
  );
  assertEquals(result, { status: "proposal_pending" });
  assertEquals(rpcCalled, false);
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
