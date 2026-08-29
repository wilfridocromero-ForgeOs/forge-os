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

Deno.test("HTTP 400 retains only sanitized provider diagnostics", async () => {
  const response = new Response(
    JSON.stringify({
      error: {
        code: "invalid_function_parameters",
        type: "invalid_request_error",
        param: "tools[6].parameters",
        message: "private prompt or payload detail must not survive",
        authorization: "Bearer secret",
      },
      request_payload: "private business data",
    }),
    { status: 400, headers: { "content-type": "application/json" } },
  );

  try {
    await consumeOpenAIResponseStream(response, () => {});
    throw new Error("Expected provider failure");
  } catch (error) {
    const candidate = error as {
      code?: unknown;
      diagnostic?: unknown;
    };
    assertEquals(candidate.code, "AI_REQUEST_INVALID");
    assertEquals(candidate.diagnostic, {
      status: 400,
      code: "invalid_function_parameters",
      type: "invalid_request_error",
      param: "tools[6].parameters",
    });
    const serialized = JSON.stringify(candidate.diagnostic);
    assertEquals(serialized.includes("private"), false);
    assertEquals(serialized.includes("Bearer"), false);
  }
});
