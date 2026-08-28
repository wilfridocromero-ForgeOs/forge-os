import { consumeOpenAIResponseStream } from "./openAIStream.ts";
import { OrbRequestError } from "./protocol.ts";
import { readTerminalEntityResolution } from "./entityResolution.ts";

export const MAX_TOOL_ROUNDS = 3;

type ToolCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

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
    const executions = await Promise.all(
      calls.map(async (call) => ({
        call,
        value: await execute(call.name, call.arguments),
      })),
    );
    const clarification = executions
      .map(({ value }) => readTerminalEntityResolution(value))
      .find((value): value is string => Boolean(value));
    if (clarification) return controlledStop(result, clarification);
    const outputs = executions.map(({ call, value }) => ({
      type: "function_call_output",
      call_id: call.call_id,
      output: JSON.stringify(value).slice(0, 24000),
    }));
    currentInput = [...currentInput, ...result.outputItems, ...outputs];
  }
  throw new OrbRequestError(
    "TOOL_ROUND_LIMIT",
    502,
    "Orb exceeded the tool round limit.",
  );
}
