import { consumeOpenAIResponseStream } from "./openAIStream.ts";
import { OrbRequestError } from "./protocol.ts";
import { readTerminalEntityResolution } from "./entityResolution.ts";

export const MAX_TOOL_ROUNDS = 4;

type ToolCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

const TOOL_EXECUTION_PHASES: Readonly<Record<string, number>> = Object.freeze({
  resolve_project_assignee: 1,
  resolve_task_date: 1,
  prepare_create_project_task: 2,
});

export function getToolExecutionPhase(name: string): number {
  return TOOL_EXECUTION_PHASES[name] ?? 0;
}

function readTemporalClarification(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const wrapper = value as { status?: unknown; data?: { state?: unknown } };
  if (wrapper.status !== "ok") return null;
  if (wrapper.data?.state === "NEEDS_TIMEZONE") {
    return "Necesito una zona horaria válida para interpretar esa fecha. Indícame la fecha exacta con zona horaria.";
  }
  if (wrapper.data?.state === "AMBIGUOUS") {
    return "No pude interpretar esa fecha con seguridad. Indícame una fecha exacta y, si corresponde, la hora.";
  }
  return null;
}

export type OrbToolLoopResult = {
  output: string;
  responseId: string;
  outputItems: Record<string, unknown>[];
  toolCalls: Record<string, unknown>[];
  diagnosticCode?: string;
};

export async function runOrbToolLoop(
  { request, input, execute, onDelta, maxRounds = MAX_TOOL_ROUNDS }: {
    request: (input: unknown[]) => Promise<Response>;
    input: unknown[];
    execute: (name: string, args: string) => Promise<unknown>;
    onDelta: (delta: string) => void;
    maxRounds?: number;
  },
): Promise<OrbToolLoopResult> {
  let currentInput = [...input];
  const executedSignatures = new Set<string>();
  const controlledStop = (
    result: OrbToolLoopResult,
    output: string,
    diagnosticCode?: string,
  ) => {
    onDelta(output);
    return {
      ...result,
      output,
      toolCalls: [],
      ...(diagnosticCode ? { diagnosticCode } : {}),
    };
  };
  for (let round = 0; round < maxRounds; round += 1) {
    const result = await consumeOpenAIResponseStream(
      await request(currentInput),
      onDelta,
      true,
    ) as {
      output: string;
      responseId: string;
      outputItems: Record<string, unknown>[];
      toolCalls: Record<string, unknown>[];
    } as OrbToolLoopResult;
    if (!result.toolCalls.length) return result;
    const calls = result.toolCalls.slice(0, 4) as ToolCall[];
    const signatures = calls.map((call) => {
      let normalizedArguments = call.arguments;
      try {
        normalizedArguments = JSON.stringify(
          JSON.parse(call.arguments || "{}"),
        );
      } catch {
        // Invalid arguments are handled by the registry without exposing details.
      }
      return `${call.name}:${normalizedArguments}`;
    });
    if (signatures.some((signature) => executedSignatures.has(signature))) {
      return controlledStop(
        result,
        "No pude terminar de identificar la entidad y no se ejecutó ninguna acción.",
        "TOOL_ROUND_LIMIT",
      );
    }
    if (round === maxRounds - 1) {
      return controlledStop(
        result,
        "No pude completar la solicitud y no se ejecutó ninguna acción.",
        "TOOL_ROUND_LIMIT",
      );
    }
    signatures.forEach((signature) => executedSignatures.add(signature));
    const executions = new Map<string, unknown>();
    const phases = [
      ...new Set(calls.map((call) => getToolExecutionPhase(call.name))),
    ]
      .sort((left, right) => left - right);
    for (const phase of phases) {
      const phaseCalls = calls.filter((call) =>
        getToolExecutionPhase(call.name) === phase
      );
      const phaseExecutions = await Promise.all(
        phaseCalls.map(async (call) => ({
          call,
          value: await execute(call.name, call.arguments),
        })),
      );
      phaseExecutions.forEach(({ call, value }) =>
        executions.set(call.call_id, value)
      );
      const clarification = phaseExecutions
        .map(({ value }) => readTerminalEntityResolution(value))
        .find((value): value is string => Boolean(value));
      if (clarification) return controlledStop(result, clarification);
      const temporalClarification = phaseExecutions
        .map(({ value }) => readTemporalClarification(value))
        .find((value): value is string => Boolean(value));
      if (temporalClarification) {
        return controlledStop(result, temporalClarification);
      }
    }
    const outputs = calls.map((call) => ({
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify(executions.get(call.call_id)).slice(0, 24000),
    }));
    currentInput = [...currentInput, ...result.outputItems, ...outputs];
  }
  throw new OrbRequestError(
    "TOOL_ROUND_LIMIT",
    502,
    "Orb exceeded the tool round limit.",
  );
}
