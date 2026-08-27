import {
  handleOrbChat,
  persistFinalOrbResponse,
  readOpenAIKey,
} from "./index.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

const payload = {
  conversation_id: "11111111-1111-4111-8111-111111111111",
  client_message_id: "22222222-2222-4222-8222-222222222222",
  message: "Hola Orb",
};

Deno.test("requires a JWT before touching backend services", async () => {
  const response = await handleOrbChat(
    new Request("http://localhost/orb-chat", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  );
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error, "AUTH_REQUIRED");
});

Deno.test({
  name: "returns AI_NOT_CONFIGURED without making an OpenAI request",
  permissions: { env: true },
  fn() {
    Deno.env.delete("OPENAI_API_KEY");
    try {
      readOpenAIKey();
      throw new Error("Expected AI_NOT_CONFIGURED");
    } catch (error) {
      assertEquals(
        error instanceof Error ? error.message : "",
        "Orb is not configured yet.",
      );
    }
  },
});

Deno.test("persists exactly one final assistant response without internal tool items", async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return Promise.resolve({ data: true, error: null });
    },
  };
  await persistFinalOrbResponse(client as never, {
    assistantMessageId: "assistant-1",
    processingToken: "token-1",
    output: "Respuesta final",
    providerResponseId: "response-1",
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].name, "complete_orb_assistant_message");
  assertEquals(calls[0].args.target_content, "Respuesta final");
  assertEquals(JSON.stringify(calls[0]).includes("function_call"), false);
  assertEquals(
    JSON.stringify(calls[0]).includes("function_call_output"),
    false,
  );
});

Deno.test({
  name: "rejects oversized input before authentication services",
  permissions: { env: true },
  async fn() {
    Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
    Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key");
    Deno.env.delete("OPENAI_API_KEY");
    const response = await handleOrbChat(
      new Request("http://localhost/orb-chat", {
        method: "POST",
        headers: { authorization: "Bearer test-user-token" },
        body: JSON.stringify({ ...payload, message: "x".repeat(8_001) }),
      }),
    );
    assertEquals(response.status, 413);
    assertEquals((await response.json()).error, "MESSAGE_TOO_LARGE");
  },
});
