import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(here, "../migrations/20260825222738_orb_v1_backend.sql"),
  "utf8",
);
const db = new PGlite();

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant authenticated, service_role to current_user;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create table public.organizations (id uuid primary key, name text not null);
  create table public.organization_memberships (
    user_id uuid not null references auth.users(id) on delete cascade,
    organization_id uuid not null references public.organizations(id) on delete cascade,
    role text not null,
    primary key (user_id, organization_id)
  );
  create table public.user_active_organizations (
    user_id uuid primary key references auth.users(id) on delete cascade,
    organization_id uuid not null,
    foreign key (user_id, organization_id)
      references public.organization_memberships(user_id, organization_id) on delete cascade
  );
  create function public.current_user_organization_id()
  returns uuid language sql stable security definer set search_path = '' as $$
    select organization_id from public.user_active_organizations
    where user_id = (select auth.uid())
  $$;
  create function public.current_user_membership_role()
  returns text language sql stable security definer set search_path = '' as $$
    select role from public.organization_memberships
    where user_id = (select auth.uid())
      and organization_id = public.current_user_organization_id()
  $$;
  create function public.set_updated_at()
  returns trigger language plpgsql as $$
  begin new.updated_at = now(); return new; end;
  $$;
`);

await db.exec(migration);

const orgA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orgB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";
const userC = "33333333-3333-4333-8333-333333333333";

await db.exec(`
  insert into auth.users(id) values ('${userA}'), ('${userB}'), ('${userC}');
  insert into public.organizations(id, name) values ('${orgA}', 'A'), ('${orgB}', 'B');
  insert into public.organization_memberships(user_id, organization_id, role) values
    ('${userA}', '${orgA}', 'member'),
    ('${userB}', '${orgA}', 'member'),
    ('${userC}', '${orgB}', 'member');
  insert into public.user_active_organizations(user_id, organization_id) values
    ('${userA}', '${orgA}'), ('${userB}', '${orgA}'), ('${userC}', '${orgB}');
`);

async function asUser(userId, callback) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await callback();
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}

const conversation = await asUser(userA, async () => {
  const result = await db.query("select id, organization_id, created_by from public.create_orb_conversation($1)", ["Prueba"]);
  assert.equal(result.rows[0].organization_id, orgA);
  assert.equal(result.rows[0].created_by, userA);
  return result.rows[0];
});

await assert.rejects(
  db.query(
    "insert into public.orb_conversations (organization_id, created_by, title) values ($1, $2, 'Cross org')",
    [orgA, userC],
  ),
  /orb_conversations_owner_membership_fkey/,
);

await assert.rejects(
  db.query(`insert into public.orb_messages (
    organization_id, conversation_id, created_by, role, content, status,
    client_message_id, completed_at
  ) values ($1, $2, $3, 'user', 'Cross org', 'completed', $4, now())`, [
    orgB,
    conversation.id,
    userC,
    "66666666-6666-4666-8666-666666666666",
  ]),
  /orb_messages_conversation_fkey/,
);

await asUser(userA, async () => {
  const first = await db.query(
    "select * from public.begin_orb_turn($1, $2, $3, $4, $5)",
    [conversation.id, "44444444-4444-4444-8444-444444444444", "Hola", "openai", "test-model"],
  );
  const replay = await db.query(
    "select * from public.begin_orb_turn($1, $2, $3, $4, $5)",
    [conversation.id, "44444444-4444-4444-8444-444444444444", "Hola", "openai", "test-model"],
  );
  assert.equal(first.rows[0].user_message_id, replay.rows[0].user_message_id);
  assert.equal(first.rows[0].assistant_message_id, replay.rows[0].assistant_message_id);
  assert.equal(first.rows[0].was_created, true);
  assert.equal(replay.rows[0].was_created, false);

  await assert.rejects(
    db.query("select * from public.begin_orb_turn($1, $2, $3, $4, $5)", [
      conversation.id,
      "44444444-4444-4444-8444-444444444444",
      "Contenido diferente",
      "openai",
      "test-model",
    ]),
    /Client message ID conflicts/,
  );

  const counts = await db.query("select role, count(*)::int as count from public.orb_messages group by role order by role");
  assert.deepEqual(counts.rows, [{ role: "assistant", count: 1 }, { role: "user", count: 1 }]);
});

for (const unauthorizedUser of [userB, userC]) {
  await asUser(unauthorizedUser, async () => {
    const visible = await db.query("select count(*)::int as count from public.orb_conversations");
    assert.equal(visible.rows[0].count, 0);
    await assert.rejects(
      db.query("select * from public.begin_orb_turn($1, $2, $3, $4, $5)", [
        conversation.id,
        crypto.randomUUID(),
        "Intento no autorizado",
        "openai",
        "test-model",
      ]),
      /Conversation not found/,
    );
  });
}

await asUser(userA, async () => {
  await assert.rejects(
    db.query(`insert into public.orb_messages (
      organization_id, conversation_id, role, content, status, provider, model, reply_to_message_id
    ) select organization_id, id, 'assistant', 'falso', 'pending', 'openai', 'test-model',
      '55555555-5555-4555-8555-555555555555'::uuid
      from public.orb_conversations where id = $1`, [conversation.id]),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select public.claim_orb_assistant_message($1, $2)", [
      "77777777-7777-4777-8777-777777777777",
      "88888888-8888-4888-8888-888888888888",
    ]),
    /permission denied/,
  );
});

const policyRows = await db.query(`
  select tablename, policyname from pg_policies
  where tablename in ('orb_conversations', 'orb_messages')
  order by tablename, policyname
`);
assert.equal(policyRows.rows.length, 3);

console.log("Orb V1 migration compiled; RLS, isolation, idempotency, and assistant write protection passed.");
