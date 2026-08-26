import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(here, "../migrations/20260825222738_orb_v1_backend.sql"),
  "utf8",
).toLowerCase();

const required = [
  "create table public.orb_conversations",
  "create table public.orb_messages",
  "foreign key (created_by, organization_id)",
  "foreign key (organization_id, conversation_id)",
  "foreign key (organization_id, conversation_id, reply_to_message_id)",
  "unique index orb_messages_client_idempotency_key",
  "unique index orb_messages_single_reply_key",
  "alter table public.orb_conversations enable row level security",
  "alter table public.orb_messages enable row level security",
  "organization_id = (select public.current_user_organization_id())",
  "created_by = (select auth.uid())",
  "grant select on table public.orb_messages to authenticated",
  "grant execute on function public.begin_orb_turn",
  "grant execute on function public.claim_orb_assistant_message(uuid, uuid) to service_role",
  "set search_path = ''",
];

for (const fragment of required) {
  assert.ok(migration.includes(fragment), `Missing security contract: ${fragment}`);
}

assert.ok(!migration.includes("grant insert on table public.orb_messages to authenticated"));
assert.ok(!migration.includes("grant update on table public.orb_messages to authenticated"));
assert.ok(!migration.includes("grant delete on table public.orb_messages to authenticated"));
assert.ok(!migration.includes("to anon\nusing"));

const directMessageGrants = [...migration.matchAll(/grant\s+([^;]+)\s+on table public\.orb_messages to authenticated/g)]
  .map((match) => match[1].trim());
assert.deepEqual(directMessageGrants, ["select"]);

console.log("Orb V1 migration security contract validated.");
