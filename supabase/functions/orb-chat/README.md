# Orb chat

Authenticated, organization-scoped Orb V1 backend using the OpenAI Responses
API.

Required production secret:

- `OPENAI_API_KEY`

Optional backend-only configuration:

- `ORB_AI_PROVIDER` (default `openai`)
- `ORB_AI_MODEL` (default `gpt-5.4-mini`)
- `ORB_MAX_OUTPUT_TOKENS` (default `800`, bounded to `128..2000`)
- `ORB_TIMEOUT_MS` (default `45000`, bounded to `5000..90000`)

The browser must send only `conversation_id`, `client_message_id`, and `message`
with its Supabase JWT. Provider, model, organization, instructions, and tools
are never accepted from the client. The response is an Orb-owned SSE protocol
with `start`, `delta`, `completed`, and `error` events.

No tools, Cerebro retrieval, embeddings, RAG, or write actions are active in V1
Block 1.
