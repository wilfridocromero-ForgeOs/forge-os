import { runOrbToolLoop } from "./toolLoop.ts";
import { executeOrbTool } from "./tools/registry.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Values differ");
  }
}

async function assertRejects(run: () => Promise<unknown>, expected: string) {
  try {
    await run();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expected)) return;
    throw error;
  }
  throw new Error("Expected rejection");
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
  await assertRejects(
    () =>
      runOrbToolLoop({
        input: [],
        request: () => Promise.resolve(toolCall()),
        execute: () => Promise.resolve({}),
        onDelta: () => {},
        maxRounds: 2,
      }),
    "tool round limit",
  );
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
