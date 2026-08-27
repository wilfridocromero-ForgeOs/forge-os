import { consumeOpenAIResponseStream } from "./openAIStream.ts";
import { OrbRequestError } from "./protocol.ts";

export const MAX_TOOL_ROUNDS = 3;

type ToolCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

export async function runOrbToolLoop(
  { request, input, execute, onDelta, maxRounds = MAX_TOOL_ROUNDS }: {
    request: (input: unknown[]) => Promise<Response>;
    input: unknown[];
    execute: (name: string, args: string) => Promise<unknown>;
    onDelta: (delta: string) => void;
    maxRounds?: number;
  },
) {
  let currentInput = [...input];
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
    };
    if (!result.toolCalls.length) return result;
    if (round === maxRounds - 1) {
      throw new OrbRequestError(
        "TOOL_ROUND_LIMIT",
        502,
        "Orb exceeded the tool round limit.",
      );
    }
    const calls = result.toolCalls.slice(0, 4) as ToolCall[];
    const outputs = await Promise.all(
      calls.map(async (call) => ({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(await execute(call.name, call.arguments)).slice(
          0,
          24000,
        ),
      })),
    );
    currentInput = [...currentInput, ...result.outputItems, ...outputs];
  }
  throw new OrbRequestError(
    "TOOL_ROUND_LIMIT",
    502,
    "Orb exceeded the tool round limit.",
  );
}
