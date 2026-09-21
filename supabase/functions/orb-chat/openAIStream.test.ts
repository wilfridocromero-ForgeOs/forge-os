import { consumeOpenAIResponseStream } from "./openAIStream.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

function providerStream(parts: string[], status = 200) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        parts.forEach((part) => controller.enqueue(encoder.encode(part)));
        controller.close();
      },
    }),
    { status, headers: { "content-type": "text/event-stream" } },
  );
}

Deno.test("accumulates ordered provider deltas and completes once", async () => {
  const deltas: string[] = [];
  const response = providerStream([
    'data: {"type":"response.created","response":{"id":"resp_1"}}\n\n' +
    'data: {"type":"response.output_text.delta","delta":"Hola"}\n',
    '\ndata: {"type":"response.output_text.delta","delta":" mundo"}\n\n' +
    'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}\n\n',
  ]);

  assertEquals(
    await consumeOpenAIResponseStream(response, (delta) => deltas.push(delta)),
    { output: "Hola mundo", responseId: "resp_1" },
  );
  assertEquals(deltas, ["Hola", " mundo"]);
});

Deno.test("rejects a provider error during streaming", async () => {
  const response = providerStream([
    'data: {"type":"response.output_text.delta","delta":"Parcial"}\n\n',
    'data: {"type":"response.failed","response":{"error":{"code":"rate_limit_exceeded","message":"private provider detail"}}}\n\n',
  ]);
  try {
    await consumeOpenAIResponseStream(response, () => {});
    throw new Error("Expected stream failure");
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : "",
      "Orb could not obtain a model response.",
    );
    assertEquals(
      typeof error === "object" && error && "code" in error ? error.code : null,
      "AI_RATE_LIMITED",
    );
  }
});

Deno.test("classifies a top-level provider stream error", async () => {
  const response = providerStream([
    'data: {"type":"error","code":"rate_limit_exceeded","message":"private provider detail"}\n\n',
  ]);
  try {
    await consumeOpenAIResponseStream(response, () => {});
    throw new Error("Expected stream failure");
  } catch (error) {
    assertEquals(
      typeof error === "object" && error && "code" in error ? error.code : null,
      "AI_RATE_LIMITED",
    );
  }
});

Deno.test("rejects a stream that ends without a terminal event", async () => {
  const response = providerStream([
    'data: {"type":"response.output_text.delta","delta":"Incompleto"}\n\n',
  ]);
  try {
    await consumeOpenAIResponseStream(response, () => {});
    throw new Error("Expected interrupted stream");
  } catch (error) {
    assertEquals(
      typeof error === "object" && error && "code" in error ? error.code : null,
      "AI_STREAM_INTERRUPTED",
    );
  }
});
