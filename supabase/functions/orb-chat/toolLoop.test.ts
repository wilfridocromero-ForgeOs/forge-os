import { runOrbToolLoop } from "./toolLoop.ts";
import { executeOrbTool } from "./tools/registry.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Values differ");
  }
}

function stream(events: unknown[]) {
  const body =
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
    "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
const completedText = (text: string) =>
  stream([{ type: "response.created", response: { id: "resp_final" } }, {
    type: "response.output_text.delta",
    delta: text,
  }, { type: "response.completed", response: { id: "resp_final" } }]);
const toolCall = (
  name = "list_projects",
  callId = "call_1",
  args = "{}",
) =>
  stream([{ type: "response.created", response: { id: "resp_tool" } }, {
    type: "response.output_item.done",
    item: {
      type: "function_call",
      call_id: callId,
      name,
      arguments: args,
    },
  }, { type: "response.completed", response: { id: "resp_tool" } }]);

const toolCalls = (
  calls: Array<{ name: string; callId: string; args?: string }>,
) =>
  stream([
    { type: "response.created", response: { id: "resp_tools" } },
    ...calls.map(({ name, callId, args = "{}" }) => ({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: callId,
        name,
        arguments: args,
      },
    })),
    { type: "response.completed", response: { id: "resp_tools" } },
  ]);

Deno.test("model can answer without a tool", async () => {
  let output = "";
  const result = await runOrbToolLoop({
    input: [],
    request: () => Promise.resolve(completedText("Hola")),
    execute: () => Promise.resolve({}),
    onDelta: (delta) => output += delta,
  });
  assertEquals(result.output, "Hola");
  assertEquals(output, "Hola");
});

Deno.test("v24 could skip contextual resolution when the model emitted no tool call", async () => {
  const clarification =
    "Veo una tarea candidata parecida, pero no puedo identificar con seguridad cuál es “esta tarea” solo con ese texto.";
  let executions = 0;
  const result = await runOrbToolLoop({
    input: [{
      role: "user",
      content:
        "Pásale esta tarea a Joseph para mañana y ponla en prioridad alta.",
    }],
    request: () => Promise.resolve(completedText(clarification)),
    execute: () => {
      executions += 1;
      return Promise.resolve({});
    },
    onDelta: () => {},
  });
  assertEquals(result.output, clarification);
  assertEquals(executions, 0);
});

Deno.test("contextual current-task preflight revalidates before the model can skip resolve_task", async () => {
  const projectId = "2a79d843-032b-468e-87ba-ab9410f97155";
  const taskId = "0a01449d-3526-4f26-b1c8-e154eeed3c56";
  const assigneeId = "0139263c-8d42-41aa-8426-60d0baaa2749";
  const dueAt = "2026-08-30T23:59:59.999Z";
  const surface = {
    type: "project" as const,
    route: `/proyectos/${projectId}`,
    entity_id: projectId,
    task_id: taskId,
  };
  const resolution = {
    exactProjectIds: new Set<string>(),
    exactClientIds: new Set<number>(),
    exactAssigneeIds: new Map<string, Set<string>>(),
    exactTaskDates: new Set<string>(),
    exactTaskIds: new Set<string>(),
    exactTaskProjectIds: new Map<string, string>(),
  };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "order"]) {
    chain[method] = () => chain;
  }
  chain.limit = () => chain;
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({
      data: [{
        id: taskId,
        project_id: projectId,
        title: "Activar notificaciones",
        status: "pending",
        due_at: "2026-08-22T14:46:00Z",
        project: { id: projectId, name: "Pruebas para Orvesen" },
      }],
      error: null,
    }).then(resolve);
  let round = 0;
  let firstInput: unknown[] = [];
  let proposalReached = 0;
  const result = await runOrbToolLoop({
    input: [{
      role: "user",
      content:
        "Pásale esta tarea a Joseph para mañana y ponla en prioridad alta.",
    }],
    preflightToolCalls: [{
      name: "resolve_task",
      arguments: JSON.stringify({
        task_id: taskId,
        project_id: projectId,
        name: null,
      }),
    }],
    request: (input) => {
      round += 1;
      if (round === 1) {
        firstInput = input;
        return Promise.resolve(toolCalls([
          {
            name: "resolve_project_assignee",
            callId: "call_assignee",
            args: JSON.stringify({ project_id: projectId, name: "Joseph" }),
          },
          {
            name: "resolve_task_date",
            callId: "call_date",
            args: JSON.stringify({ expression: "mañana" }),
          },
          {
            name: "prepare_update_project_task",
            callId: "call_prepare",
            args: JSON.stringify({
              task_id: taskId,
              assigned_to: assigneeId,
              due_at: dueAt,
              priority: "high",
            }),
          },
        ]));
      }
      return Promise.resolve(completedText("Propuesta preparada."));
    },
    execute: async (name, args) => {
      if (name === "resolve_task") {
        return await executeOrbTool(
          {
            client: { from: () => chain } as never,
            organizationId: "7070c469-2b6a-427c-bc33-bfec8b493201",
            userId: "user",
            permissions: {
              projects: true,
              discovery: false,
              clients: false,
              area_score: false,
              calendar: false,
            },
            resolution,
            surface,
          },
          name,
          args,
        );
      }
      if (name === "resolve_project_assignee") {
        if (!resolution.exactTaskIds.has(taskId)) {
          throw new Error("TASK_NOT_EXACT");
        }
        resolution.exactAssigneeIds.set(projectId, new Set([assigneeId]));
        return { status: "ok", data: { resolution: { state: "EXACT" } } };
      }
      if (name === "resolve_task_date") {
        resolution.exactTaskDates.add(dueAt);
        return { status: "ok", data: { state: "EXACT", value: dueAt } };
      }
      if (name === "prepare_update_project_task") {
        if (
          !resolution.exactTaskIds.has(taskId) ||
          !resolution.exactAssigneeIds.get(projectId)?.has(assigneeId) ||
          !resolution.exactTaskDates.has(dueAt)
        ) throw new Error("DEPENDENCY_NOT_EXACT");
        proposalReached += 1;
        return { status: "ok", data: { confirmation_required: true } };
      }
      throw new Error("UNEXPECTED_TOOL");
    },
    onDelta: () => {},
  });
  const preflightOutput = firstInput.find((item) =>
    (item as { type?: string }).type === "function_call_output"
  ) as { output: string };
  assertEquals(preflightOutput.output.includes('"state":"EXACT"'), true);
  assertEquals(resolution.exactTaskIds.has(taskId), true);
  assertEquals(resolution.exactTaskProjectIds.get(taskId), projectId);
  assertEquals(proposalReached, 1);
  assertEquals(result.output, "Propuesta preparada.");
});
Deno.test("valid tool call is executed and returned to the next round", async () => {
  let calls = 0;
  let secondInput: unknown[] = [];
  const result = await runOrbToolLoop({
    input: [{ role: "user", content: "proyectos" }],
    request: (input) => {
      calls++;
      if (calls === 1) return Promise.resolve(toolCall());
      secondInput = input;
      return Promise.resolve(completedText("Dos proyectos"));
    },
    execute: (name) => Promise.resolve({ name, items: [] }),
    onDelta: () => {},
  });
  assertEquals(result.output, "Dos proyectos");
  assertEquals(calls, 2);
  assertEquals(
    (secondInput.at(-1) as { type: string }).type,
    "function_call_output",
  );
});

Deno.test("project deictic flow can request the exact authorized project summary", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  let round = 0;
  let executed: { name: string; args: string } | null = null;
  const result = await runOrbToolLoop({
    input: [{ role: "user", content: "¿Qué está pasando aquí?" }],
    request: () => {
      round += 1;
      return Promise.resolve(
        round === 1
          ? toolCall(
            "get_project_summary",
            "call_surface_project",
            JSON.stringify({ project_id: projectId }),
          )
          : completedText("Resumen autorizado del proyecto."),
      );
    },
    execute: (name, args) => {
      executed = { name, args };
      return Promise.resolve({
        status: "ok",
        data: { project: { id: projectId } },
      });
    },
    onDelta: () => {},
  });
  assertEquals(executed, {
    name: "get_project_summary",
    args: JSON.stringify({ project_id: projectId }),
  });
  assertEquals(result.output, "Resumen autorizado del proyecto.");
});
Deno.test("tool rounds are bounded", async () => {
  let executions = 0;
  const result = await runOrbToolLoop({
    input: [],
    request: () => Promise.resolve(toolCall()),
    execute: () => {
      executions += 1;
      return Promise.resolve({});
    },
    onDelta: () => {},
    maxRounds: 2,
  });
  assertEquals(result.diagnosticCode, "TOOL_ROUND_LIMIT");
  assertEquals(result.output.includes("no se ejecutó ninguna acción"), true);
  assertEquals(executions, 1);
});

Deno.test("real project typo ends with a deterministic clarification and no proposal", async () => {
  let rounds = 0;
  let proposals = 0;
  const result = await runOrbToolLoop({
    input: [{ role: "user", content: "Crea una tarea en Pruebas par Orvesen" }],
    request: () => {
      rounds += 1;
      return Promise.resolve(toolCall(
        "resolve_project",
        "call_resolve",
        JSON.stringify({ name: "Pruebas par Orvesen" }),
      ));
    },
    execute: (name) => {
      if (name === "prepare_create_project_task") proposals += 1;
      return Promise.resolve({
        status: "ok",
        data: {
          entity_type: "project",
          resolution: {
            state: "UNIQUE_CANDIDATE",
            requested: "Pruebas par Orvesen",
            candidates: [{ name: "Pruebas para Orvesen" }],
          },
        },
      });
    },
    onDelta: () => {},
  });
  assertEquals(rounds, 1);
  assertEquals(proposals, 0);
  assertEquals(
    result.output.includes("¿Te refieres a “Pruebas para Orvesen”?"),
    true,
  );
});

Deno.test("repeated equivalent lookup stops safely without another query", async () => {
  let round = 0;
  let executions = 0;
  const result = await runOrbToolLoop({
    input: [],
    request: () => {
      round += 1;
      return Promise.resolve(toolCall(
        "list_projects",
        `call_${round}`,
        '{"search":"Acme","limit":10,"status":null}',
      ));
    },
    execute: () => {
      executions += 1;
      return Promise.resolve({ status: "ok", data: { items: [] } });
    },
    onDelta: () => {},
  });
  assertEquals(round, 2);
  assertEquals(executions, 1);
  assertEquals(result.diagnosticCode, "TOOL_ROUND_LIMIT");
});

Deno.test("two tool rounds preserve each call_id and return only the final answer", async () => {
  const requests: unknown[][] = [];
  const executed: string[] = [];
  let round = 0;
  const result = await runOrbToolLoop({
    input: [{ role: "user", content: "resumen" }],
    request: (input) => {
      requests.push(input);
      round += 1;
      if (round === 1) {
        return Promise.resolve(toolCall("list_projects", "call_projects"));
      }
      if (round === 2) {
        return Promise.resolve(toolCall("list_tasks", "call_tasks"));
      }
      return Promise.resolve(completedText("Respuesta empresarial final"));
    },
    execute: (name) => {
      executed.push(name);
      return Promise.resolve({ status: "ok", data: { count: 1 } });
    },
    onDelta: () => {},
  });
  assertEquals(executed, ["list_projects", "list_tasks"]);
  assertEquals(
    (requests[1].at(-1) as { call_id: string }).call_id,
    "call_projects",
  );
  assertEquals(
    (requests[2].at(-1) as { call_id: string }).call_id,
    "call_tasks",
  );
  assertEquals(result.output, "Respuesta empresarial final");
  assertEquals(result.output.includes("count"), false);
});

Deno.test("multiple tools in one round preserve call ids and isolate a partial failure", async () => {
  let round = 0;
  let secondInput: unknown[] = [];
  const result = await runOrbToolLoop({
    input: [{ role: "user", content: "prioridades" }],
    request: (input) => {
      round += 1;
      if (round === 1) {
        return Promise.resolve(toolCalls([
          { name: "list_tasks", callId: "call_tasks" },
          { name: "list_calendar_items", callId: "call_calendar" },
        ]));
      }
      secondInput = input;
      return Promise.resolve(completedText("Prioridad final"));
    },
    execute: (name) =>
      Promise.resolve(
        name === "list_tasks"
          ? { status: "ok", data: { items: [] } }
          : { status: "unavailable" },
      ),
    onDelta: () => {},
  });
  const outputs = secondInput.slice(-2) as Array<{
    call_id: string;
    output: string;
  }>;
  assertEquals(outputs.map((item) => item.call_id), [
    "call_tasks",
    "call_calendar",
  ]);
  assertEquals(outputs[0].output, '{"status":"ok","data":{"items":[]}}');
  assertEquals(outputs[1].output, '{"status":"unavailable"}');
  assertEquals(result.output, "Prioridad final");
});

Deno.test("dependent assignee resolution waits for a slow exact project in the same batch", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const executionOrder: string[] = [];
  let projectExact = false;
  let round = 0;
  const result = await runOrbToolLoop({
    input: [],
    request: () => {
      round += 1;
      return Promise.resolve(
        round === 1
          ? toolCalls([
            {
              name: "resolve_project_assignee",
              callId: "call_assignee",
              args: JSON.stringify({ project_id: projectId, name: "Joseph" }),
            },
            {
              name: "resolve_project",
              callId: "call_project",
              args: JSON.stringify({ name: "Pruebas para Orvesen" }),
            },
          ])
          : completedText("Joseph fue resuelto de forma exacta."),
      );
    },
    execute: async (name) => {
      if (name === "resolve_project") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        projectExact = true;
        executionOrder.push(name);
        return {
          status: "ok",
          data: { resolution: { state: "EXACT", id: projectId } },
        };
      }
      if (name === "resolve_project_assignee") {
        if (!projectExact) return { status: "entity_not_resolved" };
        executionOrder.push(name);
        return {
          status: "ok",
          data: { resolution: { state: "EXACT", id: "user-joseph" } },
        };
      }
      return { status: "unavailable" };
    },
    onDelta: () => {},
  });
  assertEquals(executionOrder, ["resolve_project", "resolve_project_assignee"]);
  assertEquals(result.output, "Joseph fue resuelto de forma exacta.");
});

Deno.test("task creation dependencies remain ordered under adversarial delays", async () => {
  const completed = new Set<string>();
  const started: string[] = [];
  let round = 0;
  const result = await runOrbToolLoop({
    input: [],
    request: () => {
      round += 1;
      return Promise.resolve(
        round === 1
          ? toolCalls([
            { name: "prepare_create_project_task", callId: "call_prepare" },
            { name: "resolve_task_date", callId: "call_date" },
            { name: "resolve_project_assignee", callId: "call_assignee" },
            { name: "resolve_project", callId: "call_project" },
          ])
          : completedText("Propuesta preparada."),
      );
    },
    execute: async (name) => {
      started.push(name);
      if (name === "resolve_project") {
        await new Promise((resolve) => setTimeout(resolve, 20));
        completed.add(name);
        return {
          status: "ok",
          data: { resolution: { state: "EXACT", id: "project-1" } },
        };
      }
      if (name === "resolve_project_assignee") {
        assertEquals(completed.has("resolve_project"), true);
        await new Promise((resolve) => setTimeout(resolve, 15));
        completed.add(name);
        return {
          status: "ok",
          data: { resolution: { state: "EXACT", id: "user-joseph" } },
        };
      }
      if (name === "resolve_task_date") {
        assertEquals(completed.has("resolve_project"), true);
        completed.add(name);
        return {
          status: "ok",
          data: { state: "EXACT", value: "2026-08-29T12:00:00Z" },
        };
      }
      assertEquals(completed.has("resolve_project_assignee"), true);
      assertEquals(completed.has("resolve_task_date"), true);
      completed.add(name);
      return { status: "ok", data: { proposal_id: "proposal-1" } };
    },
    onDelta: () => {},
  });
  assertEquals(started[0], "resolve_project");
  assertEquals(started.at(-1), "prepare_create_project_task");
  assertEquals(result.output, "Propuesta preparada.");
});

Deno.test("task update waits for task, assignee and date under inverted latency", async () => {
  const completed = new Set<string>();
  const started: string[] = [];
  let round = 0;
  await runOrbToolLoop({
    input: [],
    request: () => {
      round += 1;
      return Promise.resolve(
        round === 1
          ? toolCalls([
            { name: "prepare_update_project_task", callId: "prepare" },
            { name: "resolve_project_assignee", callId: "assignee" },
            { name: "resolve_task_date", callId: "date" },
            { name: "resolve_task", callId: "task" },
          ])
          : completedText("Propuesta de actualización preparada."),
      );
    },
    execute: async (name) => {
      started.push(name);
      if (name === "resolve_task") {
        await new Promise((resolve) => setTimeout(resolve, 25));
        completed.add(name);
        return { status: "ok", data: { resolution: { state: "EXACT" } } };
      }
      if (name === "resolve_project_assignee" || name === "resolve_task_date") {
        assertEquals(completed.has("resolve_task"), true);
        await new Promise((resolve) =>
          setTimeout(resolve, name === "resolve_project_assignee" ? 20 : 5)
        );
        completed.add(name);
        return {
          status: "ok",
          data: name === "resolve_task_date"
            ? { state: "EXACT" }
            : { resolution: { state: "EXACT" } },
        };
      }
      assertEquals(completed.has("resolve_project_assignee"), true);
      assertEquals(completed.has("resolve_task_date"), true);
      completed.add(name);
      return { status: "ok", data: { proposal_id: "proposal" } };
    },
    onDelta: () => {},
  });
  assertEquals(started[0], "resolve_task");
  assertEquals(started.at(-1), "prepare_update_project_task");
});

Deno.test("a non-exact project stops before dependent assignee or prepare tools", async () => {
  const executed: string[] = [];
  const result = await runOrbToolLoop({
    input: [],
    request: () =>
      Promise.resolve(toolCalls([
        { name: "resolve_project", callId: "call_project" },
        { name: "resolve_project_assignee", callId: "call_assignee" },
        { name: "prepare_create_project_task", callId: "call_prepare" },
      ])),
    execute: (name) => {
      executed.push(name);
      return Promise.resolve({
        status: "ok",
        data: {
          entity_type: "project",
          resolution: {
            state: "NOT_FOUND",
            requested: "Proyecto inexistente",
            candidates: [],
          },
        },
      });
    },
    onDelta: () => {},
  });
  assertEquals(executed, ["resolve_project"]);
  assertEquals(result.output.includes("No encontré"), true);
});

Deno.test("sanitized tool failure remains controlled and reaches a final response", async () => {
  let round = 0;
  let receivedOutput = "";
  const result = await runOrbToolLoop({
    input: [],
    request: (input) => {
      round += 1;
      if (round === 1) {
        return Promise.resolve(toolCall("list_projects", "call_failure"));
      }
      receivedOutput = String((input.at(-1) as { output: string }).output);
      return Promise.resolve(completedText("No pude consultar esa fuente."));
    },
    execute: () => Promise.resolve({ status: "unavailable" }),
    onDelta: () => {},
  });
  assertEquals(receivedOutput, '{"status":"unavailable"}');
  assertEquals(receivedOutput.includes("stack"), false);
  assertEquals(result.output, "No pude consultar esa fuente.");
});

Deno.test("unknown tool executes no business query and the loop remains controlled", async () => {
  let queried = false;
  let round = 0;
  let toolOutput = "";
  const client = {
    from: () => {
      queried = true;
      throw new Error("unexpected");
    },
  };
  const permissions = {
    projects: true,
    discovery: false,
    area_score: false,
    clients: false,
    calendar: false,
  };
  const result = await runOrbToolLoop({
    input: [],
    request: (input) => {
      round += 1;
      if (round === 1) {
        return Promise.resolve(toolCall("unknown_tool", "call_unknown"));
      }
      toolOutput = String((input.at(-1) as { output: string }).output);
      return Promise.resolve(
        completedText("No tengo acceso a esa herramienta."),
      );
    },
    execute: (name, args) =>
      executeOrbTool(
        {
          client: client as never,
          organizationId: "org",
          userId: "user",
          permissions,
        },
        name,
        args,
      ),
    onDelta: () => {},
  });
  assertEquals(queried, false);
  assertEquals(toolOutput, '{"status":"unauthorized"}');
  assertEquals(result.output, "No tengo acceso a esa herramienta.");
});
