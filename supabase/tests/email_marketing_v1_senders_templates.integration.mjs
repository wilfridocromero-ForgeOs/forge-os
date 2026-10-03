// Email Marketing V1 - Increment 3a (senders, templates, email-content.v1)
// integration tests (PGlite).
//
// PGlite is intentionally not a project dependency. Run with an ephemeral npx:
//   npx -y -p @electric-sql/pglite node --test supabase/tests/email_marketing_v1_senders_templates.integration.mjs
//
// EMAIL_INC3A_MIGRATION_PATH (read by the harness) may point at an alternative
// Increment 3a migration. It exists only for the mutation runner.
//
// Limits of this environment, stated explicitly: PGlite is single-connection
// with a C default collation. Real concurrent interleavings and locale-
// dependent ordering cannot be executed here; races are simulated
// deterministically with test-only statement triggers, and lock/collation
// contracts are additionally verified by the static validator.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  A_ADMIN, A_FOUNDER, A_LEAD, A_MEMBER, B_FOUNDER, EXPECTED_INC1_FP_AFTER_INC3A, INC1_NAMES, INC2_NAMES,
  MIGRATIONS, NEW_TABLES, NO_ORG, OLD_TABLES, ORG_A, ORG_B, STAGING_INC1_FP, STAGING_INC2_FP,
  createDatabase, readSql, snapshots,
} from "./email_marketing_v1_harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(resolve(here, "fixtures/email_content_v1_cases.json"), "utf8"));
const U = (...codepoints) => String.fromCodePoint(...codepoints);
const PAST = "2026-09-01T10:00:00Z";

const db = await createDatabase();
const snap = snapshots(db);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const count = async (sql, params = []) => (await one(sql, params)).count;
const j = (value) => JSON.stringify(value);

const OLD_ACTIONS = ["read", "manage_contacts", "manage_consent", "manage_suppressions", "lift_suppression"];
const NEW_ACTIONS = ["manage_senders", "manage_content", "manage_campaigns"];
const PROBE_ACTIONS = [...OLD_ACTIONS, ...NEW_ACTIONS, "manage_audiences", "READ", "", " read", null];
const PROBE_USERS = [A_FOUNDER, A_ADMIN, A_LEAD, A_MEMBER, B_FOUNDER, NO_ORG, ""];
async function canMatrix() {
  const result = {};
  for (const user of PROBE_USERS) {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    for (const action of PROBE_ACTIONS) {
      result[`${user || "nobody"}:${action}`] = (await one("select private.email_can($1) as v", [action])).v;
    }
  }
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  return result;
}

await db.exec(readSql(MIGRATIONS.inc1));
await db.exec(readSql(MIGRATIONS.inc2));
const before = {
  inc1Fp: await snap.fp(INC1_NAMES), inc2Fp: await snap.fp(INC2_NAMES),
  inc1FpWithoutCan: await snap.fp(INC1_NAMES.filter((n) => n !== "email_can")),
  functions: await snap.functions(), policies: await snap.policies(), tableAcl: await snap.tableAcl(),
  constraints: await snap.constraints(), triggers: await snap.triggers(), indexes: await snap.indexes(),
  canMatrix: await canMatrix(),
};
await db.exec(readSql(MIGRATIONS.inc3a));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function as(role, userId, callback) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${userId || ""}', false);`);
  try {
    return await callback();
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}
const asUser = (userId, callback) => as("authenticated", userId, callback);
const asAnon = (callback) => as("anon", null, callback);
const asService = (callback) => as("service_role", null, callback);

const MINIMAL = { version: "email-content.v1", blocks: [{ type: "paragraph", text: "Hola" }] };
const content = (...blocks) => ({ version: "email-content.v1", blocks });
const paragraph = (text) => ({ type: "paragraph", text });
// Raw JSON text of a fixture body (content_json keeps the exact textual form).
const bodyText = (fixture) => fixture.content_json ?? j(fixture.content === "MINIMAL" ? MINIMAL : fixture.content);

const rpc = {
  createDomain: (domain) => one("select * from public.email_create_sender_domain($1)", [domain]),
  archiveDomain: (id) => one("select * from public.email_archive_sender_domain($1)", [id]),
  createIdentity: (domain, local, name, replyTo = null) =>
    one("select * from public.email_create_sender_identity($1, $2, $3, $4)", [domain, local, name, replyTo]),
  updateIdentity: (id, changes, version = null) =>
    one("select * from public.email_update_sender_identity($1, $2::jsonb, $3)", [id, j(changes), version]),
  archiveIdentity: (id) => one("select * from public.email_archive_sender_identity($1)", [id]),
  createTemplate: (name, description = null) => one("select * from public.email_create_template($1, $2)", [name, description]),
  archiveTemplate: (id) => one("select * from public.email_archive_template($1)", [id]),
  createVersionText: (template, subject, preheader, text, expected) =>
    one("select * from public.email_create_template_version($1, $2, $3, $4::jsonb, $5)", [template, subject, preheader, text, expected]),
  createVersion: (template, subject, preheader, body, expected) => rpc.createVersionText(template, subject, preheader, j(body), expected),
  validateText: (subject, preheader, text) =>
    one("select public.email_validate_content($1, $2, $3::jsonb) as r", [subject, preheader, text]).then((r) => r.r),
  validate: (subject, preheader, body) => rpc.validateText(subject, preheader, j(body)),
  // Increment 1-2 (regression)
  createContact: (email, first = null) => one("select * from public.email_create_contact($1, $2)", [email, first]),
  grant: (id) => one("select * from public.email_record_consent($1, 'written', 'Formulario', 'Acepto emails', 'v1', $2)", [id, PAST]),
  revoke: (id) => one("select * from public.email_revoke_consent($1, 'user_request')", [id]),
  createList: (name) => one("select * from public.email_create_list($1)", [name]),
  addMembers: (list, ids) => one("select public.email_add_list_members($1, $2::uuid[]) as r", [list, ids]).then((r) => r.r),
  createField: (key, label, type, options = []) =>
    one("select * from public.email_create_custom_field($1, $2, $3, $4::jsonb)", [key, label, type, j(options)]),
  archiveField: (id) => one("select * from public.email_archive_custom_field($1)", [id]),
  preview: (definition) => one("select public.email_preview_audience($1::jsonb, 50) as r", [j(definition)]).then((r) => r.r),
};

// Fails closed: the message must match exactly, and an expected detail must be
// present and equal (a missing detail is a failure, never a skip).
const rejectsWith = (promise, message, detail) => assert.rejects(promise, (error) => {
  assert.equal(error.message, message);
  if (detail !== undefined) {
    assert.notEqual(error.detail, undefined, `${message}: expected detail "${detail}" but the error carries none`);
    assert.equal(error.detail, detail);
  }
  return true;
});
const tableCounts = async () => {
  const result = {};
  for (const table of [...OLD_TABLES, ...NEW_TABLES]) result[table] = await count(`select count(*)::int from public.${table}`);
  return result;
};
const sha256Hex = async (text) => (await one("select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h", [text])).h;
const s = {};

// ---------------------------------------------------------------------------
// Migration safety: nothing existing is weakened
// ---------------------------------------------------------------------------

test("fingerprints: runner algorithm reproduces Staging; only email_can changes", async () => {
  assert.equal(before.inc1Fp, STAGING_INC1_FP, "local Inc1 fingerprint reproduces the value validated on Staging");
  assert.equal(before.inc2Fp, STAGING_INC2_FP, "local Inc2 fingerprint reproduces the value validated on Staging");
  assert.equal(await snap.fp(INC2_NAMES), STAGING_INC2_FP, "Inc2 fingerprint (runner ENV-07) is unchanged");
  const inc1After = await snap.fp(INC1_NAMES);
  assert.notEqual(inc1After, STAGING_INC1_FP, "Inc1 fingerprint (runner ENV-06) changes by design");
  assert.equal(inc1After, EXPECTED_INC1_FP_AFTER_INC3A, "and changes to the documented value");
  assert.equal(await snap.fp(INC1_NAMES.filter((n) => n !== "email_can")), before.inc1FpWithoutCan,
    "the other 20 Inc1 functions keep their fingerprint");
});

test("every Increment 1-2 function except email_can is unchanged (source, definer, config, ACL, owner)", async () => {
  const after = await snap.functions();
  const afterBySig = Object.fromEntries(after.map((f) => [f.sig, f]));
  for (const old of before.functions) {
    const now = afterBySig[old.sig];
    assert.ok(now, `${old.sig} still exists`);
    if (old.sig === "private.email_can(text)") {
      assert.notEqual(now.src, old.src, "email_can source changed (three actions added)");
      assert.deepEqual({ ...now, src: null }, { ...old, src: null }, "email_can definer/config/ACL/owner/volatility unchanged");
    } else {
      assert.deepEqual(now, old, old.sig);
    }
  }
  const oldSigs = new Set(before.functions.map((f) => f.sig));
  const added = after.filter((f) => !oldSigs.has(f.sig));
  assert.equal(added.length, 30, "21 private helpers/triggers + 9 public RPCs");
  assert.equal(after.length, 51 + 30, "runner ENV-09 count moves from 51 to 81");
  for (const name of INC1_NAMES.concat(INC2_NAMES)) {
    const matches = (list) => list.filter((f) => f.sig.replace(/^[a-z]+\./, "").startsWith(`${name}(`)).length;
    assert.equal(matches(after), matches(before.functions), `no overload of ${name}`);
  }
});

test("email_can: every existing decision is identical; new actions follow the same roles", async () => {
  const after = await canMatrix();
  for (const [key, value] of Object.entries(before.canMatrix)) {
    const action = key.split(":").slice(1).join(":");
    if (NEW_ACTIONS.includes(action)) {
      assert.equal(value, false, `${key} was false before Increment 3a`);
      continue;
    }
    assert.equal(after[key], value, `${key} unchanged`);
  }
  for (const user of PROBE_USERS) {
    const privileged = [A_FOUNDER, A_ADMIN, B_FOUNDER].includes(user);
    for (const action of NEW_ACTIONS) {
      assert.equal(after[`${user || "nobody"}:${action}`], privileged, `${user || "nobody"}:${action}`);
      assert.equal(after[`${user || "nobody"}:${action}`], after[`${user || "nobody"}:read`], "same roles as read");
    }
  }
});

test("existing policies, table grants, RLS, constraints, triggers and indexes are unchanged", async () => {
  const onlyOld = (rows, key) => rows.filter((r) => OLD_TABLES.includes(r[key]));
  assert.deepEqual(onlyOld(await snap.policies(), "tablename"), before.policies);
  assert.deepEqual(onlyOld(await snap.tableAcl(), "relname"), before.tableAcl);
  assert.deepEqual(onlyOld(await snap.triggers(), "tbl"), before.triggers);
  assert.deepEqual(onlyOld(await snap.indexes(), "tablename"), before.indexes);
  const constraintsAfter = onlyOld(await snap.constraints(), "tbl");
  const key = (c) => `${c.tbl}.${c.conname}`;
  assert.deepEqual(constraintsAfter.map(key), before.constraints.map(key));
  for (const old of before.constraints) {
    const now = constraintsAfter.find((c) => key(c) === key(old));
    if (old.conname === "email_audit_log_entity_type_check") {
      for (const type of old.def.match(/'[a-z_]+'/g)) assert.ok(now.def.includes(type), `audit entity type ${type} kept`);
      for (const type of ["sender_domain", "sender_identity", "template", "template_version"]) {
        assert.ok(now.def.includes(`'${type}'`), `audit entity type ${type} added`);
      }
      assert.ok(!now.def.includes("'campaign'"), "campaign entity type is not part of Increment 3a");
    } else {
      assert.deepEqual(now, old, key(old));
    }
  }
});

test("new objects: RLS on, SELECT-only policies, pinned search_path, no identity arguments", async () => {
  const rls = await all("select relname, relrowsecurity from pg_class where relname = any($1::text[])", [NEW_TABLES]);
  assert.equal(rls.length, NEW_TABLES.length);
  for (const row of rls) assert.equal(row.relrowsecurity, true, row.relname);
  const policies = await all("select tablename, cmd, roles::text as roles, qual from pg_policies where tablename = any($1::text[])", [NEW_TABLES]);
  assert.equal(policies.length, NEW_TABLES.length);
  for (const policy of policies) {
    assert.equal(policy.cmd, "SELECT", policy.tablename);
    assert.equal(policy.roles, "{authenticated}", policy.tablename);
    assert.match(policy.qual, /organization_id = \( SELECT current_user_organization_id\(\)/);
    assert.match(policy.qual, /email_can\('read'::text\)/);
  }
  assert.deepEqual(await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.proname like 'email\\_%'
      and (p.proconfig is null or not ('search_path=""' = any(p.proconfig)))`), []);
  assert.deepEqual(await all(`select p.proname, a.arg from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
      unnest(coalesce(p.proargnames, array[]::text[])) as a(arg)
    where n.nspname = 'public' and p.proname like 'email\\_%'
      and (a.arg ilike '%organization%' or a.arg ilike '%actor%' or a.arg ilike '%user%' or a.arg ilike '%created_by%')`), []);
  const definers = await all(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname like 'email\\_%' and p.prosecdef order by 1`);
  assert.deepEqual(definers.map((r) => r.proname), ["email_can", "email_is_sendable", "email_require", "email_write_audit"],
    "Increment 3a adds no SECURITY DEFINER helper");
});

test("API roles hold exactly the intended privileges", async () => {
  const tableGrants = await all(`select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name like 'email\\_%' and grantee in ('anon','authenticated','service_role')`);
  for (const row of tableGrants) {
    assert.equal(row.privilege_type, "SELECT", `${row.grantee} ${row.privilege_type} ${row.table_name}`);
    assert.notEqual(row.grantee, "anon");
  }
  assert.equal(tableGrants.length, 2 * 16, "SELECT for authenticated and service_role on 16 email tables");
  const executable = await all(`select p.proname, r.rolname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
    where n.nspname in ('public','private') and p.proname like 'email\\_%' and has_function_privilege(r.rolname, p.oid, 'execute')`);
  const rpcs = [
    "email_add_suppression", "email_archive_contact", "email_create_contact", "email_lift_suppression",
    "email_record_consent", "email_revoke_consent", "email_update_contact",
    "email_create_list", "email_archive_list", "email_add_list_members", "email_remove_list_members",
    "email_create_tag", "email_archive_tag", "email_add_contact_tags", "email_remove_contact_tags",
    "email_create_custom_field", "email_archive_custom_field", "email_set_contact_fields",
    "email_create_segment", "email_update_segment", "email_archive_segment",
    "email_preview_audience", "email_preview_segment", "email_import_contacts_from_crm",
    "email_create_sender_domain", "email_archive_sender_domain", "email_create_sender_identity",
    "email_update_sender_identity", "email_archive_sender_identity", "email_create_template",
    "email_archive_template", "email_create_template_version", "email_validate_content",
  ];
  assert.equal(rpcs.length, 33, "runner SEC-06/SEC-07 move from 24 to 33 RPCs");
  const expected = new Set(["email_can:authenticated", ...rpcs.map((name) => `${name}:authenticated`)]);
  const actual = executable.map((r) => `${r.proname}:${r.rolname}`);
  assert.deepEqual(actual.filter((entry) => !expected.has(entry)), []);
  assert.equal(actual.length, expected.size);
});

// ---------------------------------------------------------------------------
// Setup for content validation (context described in the fixture file)
// ---------------------------------------------------------------------------

test("setup: custom fields from the fixture context", async () => {
  assert.deepEqual(fixtures.context, { active_custom_fields: ["plan", "a1", "a_z", "ab"], archived_custom_fields: ["legacy"] });
  await asUser(A_FOUNDER, async () => {
    s.plan = (await rpc.createField("plan", "Plan", "select", ["basic", "pro"])).field_id;
    for (const key of ["a1", "a_z", "ab"]) await rpc.createField(key, key.toUpperCase(), "text");
    s.legacy = (await rpc.createField("legacy", "Legacy", "text")).field_id;
    await rpc.archiveField(s.legacy);
  });
  // Organization B has an active 'legacy' field: foreign fields must never count.
  await asUser(B_FOUNDER, () => rpc.createField("legacy", "Legacy", "text"));
});

// ---------------------------------------------------------------------------
// Sender domains
// ---------------------------------------------------------------------------

test("sender domains: normalization, idempotency, validation", async () => {
  await asUser(A_FOUNDER, async () => {
    const created = await rpc.createDomain("  Acme.Example.COM ");
    assert.equal(created.was_created, true);
    s.domain = created.domain_id;
    assert.deepEqual({ ...(await rpc.createDomain("acme.example.com")) }, { domain_id: s.domain, was_created: false });
    for (const bad of ["", "   ", "acme", "-acme.com", "acme-.com", "a..com", "http://acme.com", "acme.com/",
      "ac me.com", "user@acme.com", `acm${U(0xe9)}.com`, "acme.com.", "127.0.0.1", `${"x".repeat(250)}.com`, `acme${U(7)}.com`, null]) {
      await rejectsWith(rpc.createDomain(bad), "EMAIL_INVALID_DOMAIN");
    }
  });
  const row = await one("select organization_id, domain, verification_status, status, created_by from public.email_sender_domains where id = $1", [s.domain]);
  assert.deepEqual({ ...row }, { organization_id: ORG_A, domain: "acme.example.com", verification_status: "unverified", status: "active", created_by: A_FOUNDER });
  // Usable maximum: an identity needs at least "a@" in front of the domain and
  // an address is at most 254 characters (RFC 5321), so a sender domain is at
  // most 252 characters, below the 253-character DNS limit.
  const label = (ch, n) => ch.repeat(n);
  const d252 = `${label("a", 63)}.${label("b", 63)}.${label("c", 63)}.${label("d", 60)}`;
  const d253 = `${label("a", 63)}.${label("b", 63)}.${label("c", 63)}.${label("d", 61)}`;
  assert.deepEqual([d252.length, d253.length], [252, 253]);
  await asUser(A_FOUNDER, async () => {
    const longest = await rpc.createDomain(d252);
    assert.equal(longest.was_created, true, "252 characters is the usable maximum");
    const identity = await rpc.createIdentity(longest.domain_id, "a", "Largo");
    assert.equal(identity.was_created, true, "a@<252> is exactly 254 characters");
    await rejectsWith(rpc.createIdentity(longest.domain_id, "ab", "Largo"), "EMAIL_INVALID_ADDRESS");
    await rejectsWith(rpc.createDomain(d253), "EMAIL_INVALID_DOMAIN", undefined);
    await rejectsWith(rpc.createDomain(`${label("a", 64)}.com`), "EMAIL_INVALID_DOMAIN");
  });
  await assert.rejects(db.query(`insert into public.email_sender_domains (organization_id, domain, created_by) values ($1, $2, $3)`,
    [ORG_A, d253, A_FOUNDER]), /check constraint/, "the column constraint enforces the same limit for every role");
  const bDomain = await asUser(B_FOUNDER, () => rpc.createDomain("acme.example.com"));
  assert.equal(bDomain.was_created, true, "another organization may register the same unverified domain");
  assert.notEqual(bDomain.domain_id, s.domain);
  s.bDomain = bDomain.domain_id;
});

// ---------------------------------------------------------------------------
// Sender identities
// ---------------------------------------------------------------------------

test("sender identities: creation, normalization, header-injection and spoofing defenses", async () => {
  await asUser(A_ADMIN, async () => {
    const created = await rpc.createIdentity(s.domain, " Hola ", " Acme Ventas ", "  Soporte@ACME.example.com ");
    assert.equal(created.was_created, true);
    s.identity = created.identity_id;
    for (const bad of ["", "   ", "x".repeat(101), "Acme\r\nBcc: x@evil.example.com", "Acme\n", `Acme${U(0x85)}`, `Acme${U(0x9b)}`,
      `Acme${U(0x2028)}`, `Acme ${U(0x202e)}gnp`, `Acme${U(0xfeff)}`, `PayPal${U(0x200f)} Security`, `PayPal${U(0x200e)}`,
      `Pay${U(0x061c)}Pal`, `Pay${U(0x200b)}Pal`, `Pay${U(0x2060)}Pal`, `Pay${U(0xad)}Pal`, `PayPal${U(0x3164)}`, U(0x3164),
      `Acme${U(0xe0041)}`, "Acme =?utf-8?b?PGNlb0BiYW5rLmNvbT4=?=", "=?UTF-8?Q?Acme?=",
      `PayPal${U(0x2800)}`, `Pay${U(0x1d173)}Pal`, `Pay${U(0x1d17a)}Pal`, `Pay${U(0x1bca0)}Pal`, `Pay${U(0x1bca3)}Pal`,
      `Pay${U(0x180b)}Pal`, `Pay${U(0x180c)}Pal`, `Pay${U(0x180f)}Pal`,
      `Pay${U(0xe0100)}Pal`, `PayPal${U(0xe01ef)}`, `Pay${U(0xe0080)}Pal`, `Pay${U(0xe01f0)}Pal`, `Pay${U(0xfff0)}Pal`,
      "Acme <ceo@bank.example.com>", "Acme \"Bank\"", "support@bank.example.com", "a\\b", null]) {
      await rejectsWith(rpc.createIdentity(s.domain, "otra", bad), "EMAIL_INVALID_ARGUMENT");
    }
    for (const bad of ["", ".a", "a.", "a..b", "a b", "a@b", U(0xf1), "x".repeat(65), "-a", "a-", "a\nb", null]) {
      await rejectsWith(rpc.createIdentity(s.domain, bad, "Acme"), "EMAIL_INVALID_ARGUMENT");
    }
    for (const bad of ["not-an-email", "a@b@c.example.com", "a@localhost"]) {
      await rejectsWith(rpc.createIdentity(s.domain, "otra", "Acme", bad), "EMAIL_INVALID_ADDRESS");
    }
    await rejectsWith(rpc.createIdentity(s.bDomain, "hola", "Acme"), "EMAIL_SENDER_DOMAIN_NOT_FOUND");
    await rejectsWith(rpc.createIdentity("00000000-0000-4000-8000-000000000000", "hola", "Acme"), "EMAIL_SENDER_DOMAIN_NOT_FOUND");
  });
  const row = await one("select organization_id, domain_id, local_part, address, from_name, reply_to, version, status from public.email_sender_identities where id = $1", [s.identity]);
  assert.deepEqual({ ...row, version: Number(row.version) }, {
    organization_id: ORG_A, domain_id: s.domain, local_part: "hola", address: "hola@acme.example.com",
    from_name: "Acme Ventas", reply_to: "soporte@acme.example.com", version: 1, status: "active",
  });
});

test("sender identities: idempotency and conflicts on the active address", async () => {
  await asUser(A_FOUNDER, async () => {
    const replay = await rpc.createIdentity(s.domain, "HOLA", "Acme Ventas", "soporte@acme.example.com");
    assert.deepEqual({ ...replay }, { identity_id: s.identity, was_created: false });
    await rejectsWith(rpc.createIdentity(s.domain, "hola", "Otro Nombre", "soporte@acme.example.com"), "EMAIL_SENDER_IDENTITY_CONFLICT");
    await rejectsWith(rpc.createIdentity(s.domain, "hola", "Acme Ventas", null), "EMAIL_SENDER_IDENTITY_CONFLICT");
  });
  assert.equal(await count("select count(*)::int from public.email_sender_identities where organization_id = $1 and address = 'hola@acme.example.com'", [ORG_A]), 1,
    "replays created no duplicate of the address");
});

test("sender identities: optimistic updates, no-op, forbidden keys, archive", async () => {
  await asUser(A_FOUNDER, async () => {
    const updated = await rpc.updateIdentity(s.identity, { from_name: "Acme Marketing" }, 1);
    assert.equal(Number(updated.version), 2);
    await rejectsWith(rpc.updateIdentity(s.identity, { from_name: "Otro" }, 1), "EMAIL_SENDER_IDENTITY_VERSION_CONFLICT");
    assert.equal(Number((await rpc.updateIdentity(s.identity, { from_name: "Acme Marketing" })).version), 2, "no-op keeps version");
    const cleared = await rpc.updateIdentity(s.identity, { reply_to: null }, 2);
    assert.equal(cleared.reply_to, null);
    assert.equal(Number(cleared.version), 3);
    const redirected = await rpc.updateIdentity(s.identity, { reply_to: " Ventas@Acme.example.com " }, 3);
    assert.equal(redirected.reply_to, "ventas@acme.example.com");
    assert.equal(Number(redirected.version), 4);
    for (const changes of [{}, { address: "x@acme.example.com" }, { local_part: "x" }, { domain_id: s.bDomain },
      { status: "archived" }, { version: 9 }, { organization_id: ORG_B }, { from_name: null }, { from_name: 5 }]) {
      await rejectsWith(rpc.updateIdentity(s.identity, changes), "EMAIL_INVALID_ARGUMENT");
    }
    await rejectsWith(rpc.updateIdentity(s.identity, { from_name: "Acme\r\nBcc: x@evil.example.com" }), "EMAIL_INVALID_ARGUMENT");
    await rejectsWith(rpc.updateIdentity(s.identity, { from_name: `Acme${U(0x200f)}` }), "EMAIL_INVALID_ARGUMENT");
    await rejectsWith(rpc.updateIdentity(s.identity, { reply_to: "nope" }), "EMAIL_INVALID_ADDRESS");

    s.identity2 = (await rpc.createIdentity(s.domain, "news", "Acme News")).identity_id;
    const archived = await rpc.archiveIdentity(s.identity2);
    assert.equal(archived.status, "archived");
    assert.equal((await rpc.archiveIdentity(s.identity2)).status, "archived", "archive is idempotent");
    await rejectsWith(rpc.updateIdentity(s.identity2, { from_name: "X" }), "EMAIL_SENDER_IDENTITY_ARCHIVED");
    const recreated = await rpc.createIdentity(s.domain, "news", "Acme News");
    assert.equal(recreated.was_created, true);
    assert.notEqual(recreated.identity_id, s.identity2, "address reusable after archive, as a new identity");
  });
});

test("sender domains: archive is blocked while identities are active, then idempotent", async () => {
  await asUser(A_FOUNDER, async () => {
    await rejectsWith(rpc.archiveDomain(s.domain), "EMAIL_SENDER_DOMAIN_IN_USE");
    s.spareDomain = (await rpc.createDomain("spare.example.com")).domain_id;
    const archived = await rpc.archiveDomain(s.spareDomain);
    assert.equal(archived.status, "archived");
    assert.equal((await rpc.archiveDomain(s.spareDomain)).status, "archived");
    await rejectsWith(rpc.createIdentity(s.spareDomain, "hola", "Acme"), "EMAIL_SENDER_DOMAIN_ARCHIVED");
    assert.equal((await rpc.createDomain("spare.example.com")).was_created, true, "domain can be registered again after archive");
  });
});

// ---------------------------------------------------------------------------
// Templates and immutable versions
// ---------------------------------------------------------------------------

test("templates: creation, idempotency, validation, archive", async () => {
  await asUser(A_FOUNDER, async () => {
    const created = await rpc.createTemplate("  Bienvenida ", "Primer correo");
    assert.equal(created.was_created, true);
    s.template = created.template_id;
    assert.deepEqual({ ...(await rpc.createTemplate("BIENVENIDA")) }, { template_id: s.template, was_created: false });
    for (const bad of ["", "   ", "x".repeat(101), `bad${U(7)}name`, null]) {
      await rejectsWith(rpc.createTemplate(bad), "EMAIL_INVALID_ARGUMENT");
    }
    // LOW 2: explicit, locale-independent set (not [[:cntrl:]]) for names and descriptions.
    for (const bad of [`Promo${U(0x202e)}txt.exe`, `Promo${U(0x85)}`, `Pro${U(0x200b)}mo`, `Promo${U(0xe0080)}`, `Promo${U(0x2028)}x`]) {
      await rejectsWith(rpc.createTemplate(bad), "EMAIL_INVALID_ARGUMENT");
      await rejectsWith(rpc.createTemplate("Descripcion invalida", bad), "EMAIL_INVALID_ARGUMENT");
    }
    assert.equal((await rpc.createTemplate(`${U(0x845b, 0xe0100)} Temporada`)).was_created, true,
      "names are not header fields: legitimate ideographic variation sequences stay valid");
    s.oldTemplate = (await rpc.createTemplate("Temporal")).template_id;
    assert.equal((await rpc.archiveTemplate(s.oldTemplate)).status, "archived");
    assert.equal((await rpc.archiveTemplate(s.oldTemplate)).status, "archived");
    await rejectsWith(rpc.createVersion(s.oldTemplate, "Hola", null, MINIMAL, 0), "EMAIL_TEMPLATE_ARCHIVED");
    assert.equal((await rpc.createTemplate("Temporal")).was_created, true);
  });
  const row = await one("select latest_version, status, organization_id from public.email_templates where id = $1", [s.template]);
  assert.deepEqual({ ...row }, { latest_version: 0, status: "active", organization_id: ORG_A });
});

test("template versions: append-only numbering, deterministic hash, idempotent replay, conflicts", async () => {
  const v1Content = content({ type: "heading", level: 1, text: "Hola {{contact.first_name|amigo}}" }, paragraph("Tu plan: {{custom.plan}}"));
  const v2Content = content(paragraph("Segunda version"));
  await asUser(A_FOUNDER, async () => {
    await rejectsWith(rpc.createVersion(s.template, "Hola", null, MINIMAL, null), "EMAIL_INVALID_ARGUMENT");
    await rejectsWith(rpc.createVersion(s.template, "Hola", null, MINIMAL, -1), "EMAIL_INVALID_ARGUMENT");

    const v1 = await rpc.createVersion(s.template, " Bienvenido ", " Novedades ", v1Content, 0);
    assert.equal(v1.was_created, true);
    assert.equal(v1.version_number, 1);
    assert.match(v1.content_sha256, /^[0-9a-f]{64}$/);
    s.v1 = v1;

    const replay = await rpc.createVersion(s.template, "Bienvenido", "Novedades", v1Content, 0);
    assert.deepEqual({ ...replay }, { ...v1, was_created: false }, "identical retry returns the same version");
    await rejectsWith(rpc.createVersion(s.template, "Bienvenido", null, v2Content, 0), "EMAIL_TEMPLATE_VERSION_CONFLICT");
    await rejectsWith(rpc.createVersion(s.template, "Bienvenido", null, v2Content, 5), "EMAIL_TEMPLATE_VERSION_CONFLICT");

    const v2 = await rpc.createVersion(s.template, "Bienvenido", null, v2Content, 1);
    assert.equal(v2.version_number, 2);
    const v3 = await rpc.createVersion(s.template, " Bienvenido ", "Novedades", v1Content, 2);
    assert.equal(v3.version_number, 3, "reverting to earlier content creates a new version");
    assert.equal(v3.content_sha256, v1.content_sha256, "same content, same hash");
    const staleRetry = await rpc.createVersion(s.template, "Bienvenido", "Novedades", v1Content, 2);
    assert.deepEqual({ ...staleRetry }, { ...v3, was_created: false });

    // jsonb is canonical: key order and whitespace never change the hash.
    s.otherTemplate = (await rpc.createTemplate("Otra")).template_id;
    const reordered = `{"blocks":[{"text":"Hola {{contact.first_name|amigo}}","level":1,"type":"heading"},{"text":"Tu plan: {{custom.plan}}","type":"paragraph"}],   "version":"email-content.v1"}`;
    const same = await rpc.createVersionText(s.otherTemplate, "Bienvenido", "Novedades", reordered, 0);
    assert.equal(same.content_sha256, v1.content_sha256);
    const differentSubject = await rpc.validate("Bienvenido!", "Novedades", v1Content);
    assert.notEqual(differentSubject.content_sha256, v1.content_sha256, "subject is part of the hash");
  });
  const rows = await all("select version_number, subject, preheader, created_by, organization_id from public.email_template_versions where template_id = $1 order by 1", [s.template]);
  assert.deepEqual(rows.map((r) => [r.version_number, r.subject, r.preheader, r.created_by, r.organization_id]), [
    [1, "Bienvenido", "Novedades", A_FOUNDER, ORG_A], [2, "Bienvenido", null, A_FOUNDER, ORG_A], [3, "Bienvenido", "Novedades", A_FOUNDER, ORG_A],
  ]);
  assert.equal((await one("select latest_version from public.email_templates where id = $1", [s.template])).latest_version, 3);
});

// ---------------------------------------------------------------------------
// email-content.v1 validation (shared fixtures + generated boundaries)
// ---------------------------------------------------------------------------

test("fixtures: every valid case is accepted with the expected merge tags and pinned hash", async () => {
  assert.ok(fixtures.valid.length >= 10);
  await asUser(A_FOUNDER, async () => {
    let index = 0;
    for (const fixture of fixtures.valid) {
      assert.ok(["exact", "db_only"].includes(fixture.parity), fixture.name);
      assert.match(fixture.content_sha256, /^[0-9a-f]{64}$/, `${fixture.name}: fixture pins a hash`);
      const result = await rpc.validateText(fixture.subject, fixture.preheader, bodyText(fixture));
      assert.equal(result.valid, true, `${fixture.name}: ${j(result)}`);
      assert.deepEqual(result.merge_tags, fixture.merge_tags, fixture.name);
      assert.equal(result.content_sha256, fixture.content_sha256, `${fixture.name}: PostgreSQL hash matches the pinned vector`);
      const template = (await rpc.createTemplate(`Fixture valid ${index += 1}`)).template_id;
      const created = await rpc.createVersionText(template, fixture.subject, fixture.preheader, bodyText(fixture), 0);
      assert.equal(created.content_sha256, fixture.content_sha256, `${fixture.name}: validate and save agree on the hash`);
    }
  });
});

test("fixtures: every invalid case (XSS, injection, malformed) is rejected with the exact detail", async () => {
  assert.ok(fixtures.invalid.length >= 100);
  await asUser(A_FOUNDER, async () => {
    const template = (await rpc.createTemplate("Fixture invalid")).template_id;
    for (const fixture of fixtures.invalid) {
      assert.ok(["exact", "db_only"].includes(fixture.parity), fixture.name);
      const result = await rpc.validateText(fixture.subject, fixture.preheader ?? null, bodyText(fixture));
      assert.deepEqual(result, { valid: false, error: "EMAIL_INVALID_CONTENT", detail: fixture.detail }, fixture.name);
      await rejectsWith(rpc.createVersionText(template, fixture.subject, fixture.preheader ?? null, bodyText(fixture), 0),
        "EMAIL_INVALID_CONTENT", fixture.detail);
    }
    assert.equal((await one("select latest_version from public.email_templates where id = $1", [template])).latest_version, 0);
  });
  assert.equal(await count("select count(*)::int from public.email_template_versions where subject like '%evil%' or content::text like '%javascript%' or content::text like '%<script%'"), 0);
});

test("H1: markup can never be assembled around a merge tag, in any text position", async () => {
  const required = ["merge tag builds an img tag", "merge tag builds a script tag", "subject merge tag builds a tag",
    "preheader merge tag builds a tag", "heading merge tag builds a tag", "button text merge tag builds a tag"];
  for (const name of required) assert.ok(fixtures.invalid.some((f) => f.name === name), `fixture present: ${name}`);
  await asUser(A_FOUNDER, async () => {
    for (const [subject, preheader, body, detail] of [
      ["Hola", null, content(paragraph("<{{contact.first_name|img src=x onerror=alert(1)}}>")), "block 1: raw HTML is not allowed"],
      ["Hola", null, content(paragraph("<{{contact.first_name|script}}>")), "block 1: raw HTML is not allowed"],
      ["<{{contact.first_name|script}}>", null, MINIMAL, "subject: raw HTML is not allowed"],
      ["Hola", "<{{contact.first_name|img}}", MINIMAL, "preheader: raw HTML is not allowed"],
      ["Hola", null, content(paragraph("<{{custom.plan}}")), "block 1: raw HTML is not allowed"],
    ]) {
      assert.deepEqual(await rpc.validate(subject, preheader, body), { valid: false, error: "EMAIL_INVALID_CONTENT", detail });
    }
    // A bare "<" that cannot start a tag stays valid next to a merge tag.
    for (const text of ["{{contact.first_name}} < 10", "5 < 6 {{contact.first_name}}", "{{contact.first_name}}<3"]) {
      assert.equal((await rpc.validate("Hola", null, content(paragraph(text)))).valid, true, text);
    }
  });
});

test("M4: merge-tag ordering is bytewise (C) and the vector discriminates locale-sensitive orderings", async () => {
  const keys = ["custom.ab", "custom.a_z", "custom.a1"];
  const order = async (collation) => (await one(`select array_agg(p order by p collate "${collation}") as a from unnest($1::text[]) as p`, [keys])).a;
  const c = await order("C");
  assert.deepEqual(c, ["custom.a1", "custom.a_z", "custom.ab"]);
  assert.notDeepEqual(await order("unicode"), c, "ICU ordering differs, so a locale-dependent sort would be observable on such a database");
  const fixture = fixtures.valid.find((f) => f.name.startsWith("merge tags sorted bytewise"));
  assert.deepEqual(fixture.merge_tags.filter((t) => t.startsWith("custom.")), c);
  assert.deepEqual([...fixture.merge_tags].sort(), fixture.merge_tags, "JS default sort (UTF-16 code units) equals C order for ASCII paths");
});

test("generated boundaries: sizes, counts and limits", async () => {
  const x = (n) => "x".repeat(n);
  const valid = [
    ["subject 200", x(200), null, MINIMAL],
    ["preheader 250", "Hola", x(250), MINIMAL],
    ["heading levels 1..3", "Hola", null, content(...[1, 2, 3].map((level) => ({ type: "heading", level, text: "h" })))],
    ["heading 300", "Hola", null, content({ type: "heading", level: 2, text: x(300) })],
    ["paragraph 5000", "Hola", null, content(paragraph(x(5000)))],
    ["button text 100", "Hola", null, content({ type: "button", text: x(100), url: "https://a.example.com" })],
    ["alt 300, width 1", "Hola", null, content({ type: "image", src: "https://a.example.com/i.png", alt: x(300), width: 1 })],
    ["spacers 4 and 96", "Hola", null, content({ type: "spacer", height: 4 }, { type: "spacer", height: 96 })],
    ["100 blocks", "Hola", null, content(...Array.from({ length: 100 }, () => ({ type: "divider" })))],
    ["url 2048", "Hola", null, content({ type: "button", text: "x", url: `https://a.example.com/${x(2048 - 22)}` })],
    ["fallback 100", "Hola", null, content(paragraph(`{{contact.first_name|${x(100)}}}`))],
  ];
  const invalid = [
    ["subject 201", x(201), null, MINIMAL, "subject: must be 1..200 characters"],
    ["preheader 251", "Hola", x(251), MINIMAL, "preheader: must be 1..250 characters"],
    ["heading 301", "Hola", null, content({ type: "heading", level: 2, text: x(301) }), "block 1: text must be 1..300 characters"],
    ["paragraph 5001", "Hola", null, content(paragraph(x(5001))), "block 1: text must be 1..5000 characters"],
    ["button text 101", "Hola", null, content({ type: "button", text: x(101), url: "https://a.example.com" }), "block 1: text must be 1..100 characters"],
    ["alt 301", "Hola", null, content({ type: "image", src: "https://a.example.com/i.png", alt: x(301) }), "block 1: alt must be a string of 0..300 characters"],
    ["101 blocks", "Hola", null, content(...Array.from({ length: 101 }, () => ({ type: "divider" }))), "content: blocks must be an array of 1..100 blocks"],
    ["over 64 KiB", "Hola", null, content(...Array.from({ length: 14 }, () => paragraph(x(4999)))), "content: exceeds 65536 bytes"],
    ["url 2049", "Hola", null, content({ type: "button", text: "x", url: `https://a.example.com/${x(2049 - 22)}` }), "block 1: url must be https:// or mailto:"],
    ["fallback 101", "Hola", null, content(paragraph(`{{contact.first_name|${x(101)}}}`)), "block 1: invalid merge tag fallback"],
    ["foreign custom field", "Hola", null, content(paragraph("{{custom.legacy}}")), "block 1: unknown merge tag: custom.legacy"],
  ];
  await asUser(A_FOUNDER, async () => {
    for (const [name, subject, preheader, body] of valid) {
      const result = await rpc.validate(subject, preheader, body);
      assert.equal(result.valid, true, `${name}: ${j(result)}`);
    }
    for (const [name, subject, preheader, body, detail] of invalid) {
      assert.deepEqual(await rpc.validate(subject, preheader, body), { valid: false, error: "EMAIL_INVALID_CONTENT", detail }, name);
    }
  });
});

// ---------------------------------------------------------------------------
// Fix-pass regressions: M1 (audit size), M2 (exact retry), M3 (races)
// ---------------------------------------------------------------------------

test("M1: a version referencing 200 custom fields saves, with bounded audit evidence", async () => {
  const keys = Array.from({ length: 200 }, (_, i) => `k${String(i).padStart(3, "0")}_${"x".repeat(35)}`);
  assert.ok(keys.every((k) => k.length === 40));
  await asUser(B_FOUNDER, async () => {
    for (const key of keys) await rpc.createField(key, "Campo", "text");
    const paragraphs = [];
    for (let i = 0; i < keys.length; i += 20) paragraphs.push(paragraph(keys.slice(i, i + 20).map((k) => `{{custom.${k}}}`).join(" ")));
    const body = content(...paragraphs);
    assert.ok(j(body).length < 65536);
    s.manyTemplate = (await rpc.createTemplate("Muchos campos")).template_id;
    const created = await rpc.createVersion(s.manyTemplate, "Hola", null, body, 0);
    assert.equal(created.was_created, true);
    s.manyVersion = created.version_id;
    const validated = await rpc.validate("Hola", null, body);
    assert.equal(validated.merge_tags.length, 200, "the full list stays available through read-only validation");
  });
  const audit = await one(`select details, pg_column_size(details) as size from public.email_audit_log
    where entity_type = 'template_version' and entity_id = $1`, [s.manyVersion]);
  assert.equal(audit.details.merge_tag_count, 200);
  assert.match(audit.details.merge_tags_sha256, /^[0-9a-f]{64}$/);
  assert.equal(audit.details.merge_tags, undefined, "no unbounded list in audit details");
  assert.ok(audit.size < 1024, `audit details stay small (${audit.size} bytes)`);
});

test("M2: an exact retry stays an exact retry after a referenced custom field is archived", async () => {
  await asUser(A_FOUNDER, async () => {
    const promo = (await rpc.createField("promo", "Promo", "text")).field_id;
    const template = (await rpc.createTemplate("Reintento")).template_id;
    const body = content(paragraph("Codigo {{custom.promo}}"));
    const v1 = await rpc.createVersion(template, "Promo", null, body, 0);
    await rpc.archiveField(promo);
    assert.deepEqual({ ...(await rpc.createVersion(template, "Promo", null, body, 0)) }, { ...v1, was_created: false },
      "retry after archive returns the existing version");
    await rejectsWith(rpc.createVersion(template, "Promo", null, content(paragraph("Otro {{custom.promo}}")), 1),
      "EMAIL_INVALID_CONTENT", "block 1: unknown merge tag: custom.promo");
    assert.equal(await count("select count(*)::int from public.email_audit_log where entity_type = 'template_version' and details ->> 'template_id' = $1", [template]), 1,
      "the retry is not audited again");
  });
});

// Test-only race simulation. A statement-level AFTER INSERT trigger fires even
// when INSERT ... ON CONFLICT DO NOTHING inserted nothing, i.e. exactly between
// the conflict and the RPC's follow-up lookup; it archives the conflicting row
// the way a concurrent transaction committing at that instant would. An
// optional BEFORE INSERT statement trigger recreates a competing active row
// before every attempt to force retry exhaustion. Removed after the test.
async function installRaceHooks() {
  await db.exec(`
    create table public.zz_race_hook (tbl text primary key, lookup_key text not null, archive_remaining integer not null, recreate boolean not null default false);
    -- Sequences are not transactional: they count simulated races even when the RPC finally raises.
    create sequence public.zz_race_fired;
    create function public.zz_race_after() returns trigger language plpgsql as $$
    declare hook public.zz_race_hook%rowtype;
    begin
      if pg_trigger_depth() > 1 then return null; end if;
      select * into hook from public.zz_race_hook where tbl = tg_table_name;
      if not found or hook.archive_remaining <= 0 then return null; end if;
      update public.zz_race_hook set archive_remaining = archive_remaining - 1 where tbl = tg_table_name;
      perform nextval('public.zz_race_fired');
      if tg_table_name = 'email_templates' then
        update public.email_templates set status = 'archived', archived_at = now() where name_normalized = hook.lookup_key and status = 'active';
      elsif tg_table_name = 'email_sender_domains' then
        update public.email_sender_domains set status = 'archived', archived_at = now() where domain = hook.lookup_key and status = 'active';
      else
        update public.email_sender_identities set status = 'archived', archived_at = now() where address = hook.lookup_key and status = 'active';
      end if;
      return null;
    end $$;
    create function public.zz_race_before() returns trigger language plpgsql as $$
    declare hook public.zz_race_hook%rowtype;
    begin
      if pg_trigger_depth() > 1 then return null; end if;
      select * into hook from public.zz_race_hook where tbl = tg_table_name and recreate;
      if found and not exists (select 1 from public.email_templates where name_normalized = hook.lookup_key and status = 'active') then
        insert into public.email_templates (organization_id, name, created_by) values ('${ORG_A}', hook.lookup_key, '${A_ADMIN}');
      end if;
      return null;
    end $$;
    create trigger zz_race_after after insert on public.email_templates for each statement execute function public.zz_race_after();
    create trigger zz_race_before before insert on public.email_templates for each statement execute function public.zz_race_before();
    create trigger zz_race_after after insert on public.email_sender_domains for each statement execute function public.zz_race_after();
    create trigger zz_race_after after insert on public.email_sender_identities for each statement execute function public.zz_race_after();
  `);
}
async function removeRaceHooks() {
  await db.exec(`
    drop trigger zz_race_after on public.email_templates;
    drop trigger zz_race_before on public.email_templates;
    drop trigger zz_race_after on public.email_sender_domains;
    drop trigger zz_race_after on public.email_sender_identities;
    drop function public.zz_race_after(); drop function public.zz_race_before(); drop table public.zz_race_hook;
    drop sequence public.zz_race_fired;
  `);
}

test("M3: a concurrent archive between conflict and lookup never yields zero rows or a false conflict", async () => {
  await installRaceHooks();
  try {
    const [template, domain, identity] = await asUser(A_FOUNDER, async () => [
      (await rpc.createTemplate("Carrera")).template_id,
      (await rpc.createDomain("race.example.com")).domain_id,
      (await rpc.createIdentity(s.domain, "carrera", "Acme Carrera")).identity_id,
    ]);
    await db.exec(`insert into public.zz_race_hook values ('email_templates', 'carrera', 1, false),
      ('email_sender_domains', 'race.example.com', 1, false), ('email_sender_identities', 'carrera@acme.example.com', 1, false)`);
    await asUser(A_FOUNDER, async () => {
      const t = await rpc.createTemplate("Carrera");
      assert.ok(t, "template: a row is always returned");
      assert.equal(t.was_created, true);
      assert.notEqual(t.template_id, template, "the archived one is replaced by a new active template");
      const d = await rpc.createDomain("race.example.com");
      assert.ok(d, "domain: a row is always returned");
      assert.equal(d.was_created, true);
      assert.notEqual(d.domain_id, domain);
      const i = await rpc.createIdentity(s.domain, "carrera", "Acme Carrera");
      assert.ok(i, "identity: a row is always returned");
      assert.equal(i.was_created, true, "no false EMAIL_SENDER_IDENTITY_CONFLICT");
      assert.notEqual(i.identity_id, identity);
    });
    assert.equal(await count("select count(*)::int from public.zz_race_hook where archive_remaining = 0"), 3, "every simulated race fired");

    // Exhaustion: a competing row is created and archived around every attempt.
    await db.exec(`insert into public.zz_race_hook values ('email_templates', 'agotado', 100, true)
      on conflict (tbl) do update set lookup_key = excluded.lookup_key, archive_remaining = excluded.archive_remaining, recreate = true;
      alter sequence public.zz_race_fired restart;`);
    await asUser(A_FOUNDER, () => rejectsWith(rpc.createTemplate("Agotado"), "EMAIL_CONCURRENT_MODIFICATION"));
    const fired = await one("select last_value, is_called from public.zz_race_fired");
    assert.deepEqual([Number(fired.last_value), fired.is_called], [3, true], "bounded: exactly three attempts, then a retryable error");
    assert.equal(await count("select count(*)::int from public.email_templates where name_normalized = 'agotado'"), 0,
      "the failed call left nothing behind");
  } finally {
    await removeRaceHooks();
  }
});

test("email_validate_content is read-only", async () => {
  const beforeCounts = await tableCounts();
  await asUser(A_FOUNDER, async () => {
    await rpc.validate("Hola", null, MINIMAL);
    await rpc.validate("<b>x</b>", null, MINIMAL);
  });
  assert.deepEqual(await tableCounts(), beforeCounts);
  await asUser(A_MEMBER, () => rejectsWith(rpc.validate("Hola", null, MINIMAL), "EMAIL_ACCESS_DENIED"));
});

test("L4: email_validate_content re-raises every error that is not EMAIL_INVALID_CONTENT", async () => {
  const original = (await one("select pg_get_functiondef('private.email_content_invalid(text,text)'::regprocedure) as d")).d;
  const inject = (errcode, message) => db.exec(`create or replace function private.email_content_invalid(location text, reason text)
    returns void language plpgsql volatile set search_path = '' as $f$
    begin raise exception using errcode = '${errcode}', message = '${message}', detail = location; end; $f$;`);
  try {
    for (const [errcode, message] of [["22023", "EMAIL_UNEXPECTED_FAULT"], ["P0001", "EMAIL_OTHER_FAULT"], ["23514", "EMAIL_CHECK_FAULT"]]) {
      await inject(errcode, message);
      await asUser(A_FOUNDER, () => rejectsWith(rpc.validate("<b>x</b>", null, MINIMAL), message, "subject"));
    }
  } finally {
    await db.exec(original);
  }
  assert.deepEqual(await asUser(A_FOUNDER, () => rpc.validate("<b>x</b>", null, MINIMAL)),
    { valid: false, error: "EMAIL_INVALID_CONTENT", detail: "subject: raw HTML is not allowed" }, "original restored");
});

// ---------------------------------------------------------------------------
// Invariants for every role, including the owner (bypasses grants and RLS)
// ---------------------------------------------------------------------------

test("immutability and lifecycle invariants hold for the owner", async () => {
  const versionId = s.v1.version_id;
  for (const [sql, pattern] of [
    [`update public.email_template_versions set subject = 'Hackeado' where id = '${versionId}'`, /EMAIL_TEMPLATE_VERSION_IMMUTABLE/],
    [`update public.email_template_versions set content = '{"version":"email-content.v1","blocks":[{"type":"divider"}]}' where id = '${versionId}'`, /EMAIL_TEMPLATE_VERSION_IMMUTABLE/],
    [`delete from public.email_template_versions where id = '${versionId}'`, /EMAIL_TEMPLATE_VERSION_IMMUTABLE/],
    [`truncate public.email_template_versions`, /EMAIL_TEMPLATE_VERSION_IMMUTABLE/],
    [`update public.email_templates set latest_version = 99 where id = '${s.template}'`, /EMAIL_TEMPLATE_VERSION_POINTER_INVALID/],
    [`update public.email_templates set latest_version = 2 where id = '${s.template}'`, /EMAIL_TEMPLATE_VERSION_POINTER_INVALID/],
    [`update public.email_templates set name = 'Renombrada' where id = '${s.template}'`, /EMAIL_CATALOG_FIELD_IMMUTABLE/],
    [`update public.email_templates set organization_id = '${ORG_B}' where id = '${s.template}'`, /EMAIL_CATALOG_IDENTITY_IMMUTABLE/],
    [`delete from public.email_templates where id = '${s.template}'`, /EMAIL_CATALOG_DELETE_FORBIDDEN/],
    [`update public.email_templates set status = 'active', archived_at = null where id = '${s.oldTemplate}'`, /EMAIL_CATALOG_ARCHIVED/],
    [`insert into public.email_templates (organization_id, name, created_by, latest_version) values ('${ORG_A}', 'Precargada', '${A_FOUNDER}', 3)`, /EMAIL_CATALOG_INVALID_INITIAL_STATE/],
    [`insert into public.email_templates (organization_id, name, created_by) values ('${ORG_A}', 'Promo' || chr(8238) || 'txt', '${A_FOUNDER}')`, /check constraint/],
    [`insert into public.email_templates (organization_id, name, description, created_by) values ('${ORG_A}', 'Okay', 'x' || chr(133), '${A_FOUNDER}')`, /check constraint/],
    [`truncate public.email_templates cascade`, /EMAIL_CATALOG_DELETE_FORBIDDEN|EMAIL_TEMPLATE_VERSION_IMMUTABLE/],
    [`insert into public.email_template_versions (organization_id, template_id, version_number, subject, content, content_sha256, created_by)
      values ('${ORG_A}', '${s.template}', 5, 'Salto', '{"version":"email-content.v1","blocks":[{"type":"divider"}]}', repeat('0', 64), '${A_FOUNDER}')`, /EMAIL_TEMPLATE_VERSION_CONFLICT/],
    [`insert into public.email_template_versions (organization_id, template_id, version_number, subject, content, content_sha256, created_by)
      values ('${ORG_A}', '${s.template}', 4, 'Hola', '{"version":"email-content.v1","blocks":[{"type":"paragraph","text":"<script>x</script>"}]}', repeat('0', 64), '${A_FOUNDER}')`, /EMAIL_INVALID_CONTENT/],
    [`insert into public.email_template_versions (organization_id, template_id, version_number, subject, content, content_sha256, created_by)
      values ('${ORG_A}', '${s.template}', 4, 'Hola', '{"version":"email-content.v1","blocks":[{"type":"paragraph","text":"<{{contact.first_name|script}}>"}]}', repeat('0', 64), '${A_FOUNDER}')`, /EMAIL_INVALID_CONTENT/],
    [`insert into public.email_template_versions (organization_id, template_id, version_number, subject, content, content_sha256, created_by)
      values ('${ORG_A}', '${s.oldTemplate}', 1, 'Hola', '{"version":"email-content.v1","blocks":[{"type":"divider"}]}', repeat('0', 64), '${A_FOUNDER}')`, /EMAIL_TEMPLATE_ARCHIVED/],
    [`update public.email_sender_domains set verification_status = 'verified' where id = '${s.domain}'`, /EMAIL_CATALOG_FIELD_IMMUTABLE/],
    [`update public.email_sender_domains set domain = 'evil.example.com' where id = '${s.domain}'`, /EMAIL_CATALOG_FIELD_IMMUTABLE/],
    [`insert into public.email_sender_domains (organization_id, domain, verification_status, created_by) values ('${ORG_A}', 'verified.example.com', 'verified', '${A_FOUNDER}')`, /check constraint/],
    [`insert into public.email_sender_domains (organization_id, domain, created_by) values ('${ORG_A}', 'Upper.Example.com', '${A_FOUNDER}')`, /check constraint/],
    [`delete from public.email_sender_domains where id = '${s.domain}'`, /EMAIL_CATALOG_DELETE_FORBIDDEN/],
    [`update public.email_sender_domains set status = 'archived', archived_at = now() where id = '${s.domain}'`, /EMAIL_SENDER_DOMAIN_IN_USE/],
    [`truncate public.email_sender_domains cascade`, /EMAIL_CATALOG_DELETE_FORBIDDEN/],
    [`update public.email_sender_identities set local_part = 'otro' where id = '${s.identity}'`, /EMAIL_CATALOG_FIELD_IMMUTABLE/],
    [`update public.email_sender_identities set address = 'x@evil.example.com' where id = '${s.identity}'`, /EMAIL_CATALOG_FIELD_IMMUTABLE/],
    [`update public.email_sender_identities set domain_id = '${s.spareDomain}' where id = '${s.identity}'`, /EMAIL_CATALOG_FIELD_IMMUTABLE/],
    [`update public.email_sender_identities set from_name = 'Acme <ceo@bank.example.com>' where id = '${s.identity}'`, /check constraint/],
    [`update public.email_sender_identities set from_name = E'Acme\\r\\nBcc: x' where id = '${s.identity}'`, /check constraint/],
    [`update public.email_sender_identities set from_name = 'Acme' || chr(8207) where id = '${s.identity}'`, /check constraint/],
    [`delete from public.email_sender_identities where id = '${s.identity}'`, /EMAIL_CATALOG_DELETE_FORBIDDEN/],
    [`insert into public.email_sender_identities (organization_id, domain_id, local_part, address, from_name, created_by)
      values ('${ORG_A}', '${s.domain}', 'x', 'x@evil.example.com', 'Acme', '${A_FOUNDER}')`, /EMAIL_SENDER_ADDRESS_MISMATCH/],
    [`insert into public.email_sender_identities (organization_id, domain_id, local_part, address, from_name, created_by, version)
      values ('${ORG_A}', '${s.domain}', 'y', 'y@acme.example.com', 'Acme', '${A_FOUNDER}', 7)`, /EMAIL_CATALOG_INVALID_INITIAL_STATE/],
    [`update public.email_audit_log set details = '{}' where entity_type = 'template_version'`, /EMAIL_AUDIT_IMMUTABLE/],
  ]) {
    await assert.rejects(db.query(sql), pattern, sql);
  }
  const versionBefore = Number((await one("select version from public.email_sender_identities where id = $1", [s.identity])).version);
  await db.query(`update public.email_sender_identities set version = 99 where id = $1`, [s.identity]);
  assert.equal(Number((await one("select version from public.email_sender_identities where id = $1", [s.identity])).version), versionBefore,
    "version cannot be set directly");
  const forged = await one(`insert into public.email_template_versions (organization_id, template_id, version_number, subject, content, content_sha256, created_by)
    values ($1, $2, 4, 'Hola', '{"version":"email-content.v1","blocks":[{"type":"divider"}]}', repeat('0', 64), $3) returning id, content_sha256`,
  [ORG_A, s.template, A_FOUNDER]);
  s.ownerVersion = forged.id;
  assert.notEqual(forged.content_sha256, "0".repeat(64), "a supplied hash is always recomputed");
  assert.equal(forged.content_sha256, (await one("select private.email_template_content_hash('Hola', null, '{\"version\":\"email-content.v1\",\"blocks\":[{\"type\":\"divider\"}]}') as h")).h);
  assert.equal((await one("select latest_version from public.email_templates where id = $1", [s.template])).latest_version, 4);
});

test("M1 (pass 2): an insert skipped by ON CONFLICT DO NOTHING leaves no version and no audit row", async () => {
  const latest = (await one("select latest_version from public.email_templates where id = $1", [s.template])).latest_version;
  const audits = () => count("select count(*)::int from public.email_audit_log where entity_type = 'template_version'");
  const versions = () => count("select count(*)::int from public.email_template_versions");
  const [auditsBefore, versionsBefore] = [await audits(), await versions()];
  // Valid next version number and content, but the id collides with an existing version.
  const skipped = await db.query(`insert into public.email_template_versions (id, organization_id, template_id, version_number, subject, content, content_sha256, created_by)
    values ($1, $2, $3, $4, 'Hola', '{"version":"email-content.v1","blocks":[{"type":"divider"}]}', repeat('0', 64), $5)
    on conflict do nothing returning id`, [s.v1.version_id, ORG_A, s.template, latest + 1, A_FOUNDER]);
  assert.equal(skipped.rows.length, 0, "the insert was skipped");
  assert.equal(await versions(), versionsBefore, "no version");
  assert.equal(await audits(), auditsBefore, "no phantom audit row");
  assert.equal(await count("select count(*)::int from public.email_audit_log where entity_id = $1", [s.v1.version_id]), 1,
    "the existing version still has exactly its own audit row");
  assert.equal((await one("select latest_version from public.email_templates where id = $1", [s.template])).latest_version, latest);
});

test("M3 (pass 2): the post-lock custom-field re-check aborts a version whose field was archived in the race window", async () => {
  // Fault injection: validation is made to accept any custom.* path, which is
  // exactly what an earlier, unlocked validation observed before a concurrent
  // archive committed. Only the guard's re-check after FOR SHARE can stop the
  // insert. (PGlite is single-connection: this simulates the window, it does
  // not prove real multi-connection concurrency.)
  const signature = "private.email_merge_tag_paths(uuid,text,text)";
  const original = (await one(`select pg_get_functiondef('${signature}'::regprocedure) as d`)).d;
  assert.equal(original.split(" and exists (").length - 1, 1, "fault-injection target is unambiguous");
  await db.exec(original.replace(" and exists (", " or exists ("));
  try {
    await asUser(A_FOUNDER, async () => {
      const field = (await rpc.createField("racefield", "Race", "text")).field_id;
      const template = (await rpc.createTemplate("Recheck")).template_id;
      const v1 = await rpc.createVersion(template, "Recheck", null, content(paragraph("{{custom.racefield}}")), 0);
      assert.equal(v1.was_created, true, "control: an active field passes the guard");
      await rpc.archiveField(field); // the state change inside the simulated window
      const body = content(paragraph("Hola"), paragraph("Otro {{custom.racefield}}"));
      assert.equal((await rpc.validate("Recheck", null, body)).valid, true, "validation is bypassed by the injected fault");
      // Same location semantics as the primary validator: the failing text's location.
      await rejectsWith(rpc.createVersion(template, "Recheck", null, body, 1), "EMAIL_INVALID_CONTENT", "block 2: unknown merge tag: custom.racefield");
      await rejectsWith(rpc.createVersion(template, "Recheck {{custom.racefield}}", null, MINIMAL, 1), "EMAIL_INVALID_CONTENT",
        "subject: unknown merge tag: custom.racefield");
      await rejectsWith(rpc.createVersion(template, "Recheck", "Pre {{custom.racefield}}", MINIMAL, 1), "EMAIL_INVALID_CONTENT",
        "preheader: unknown merge tag: custom.racefield");
      assert.equal((await one("select latest_version from public.email_templates where id = $1", [template])).latest_version, 1, "aborted safely");
      assert.equal(await count("select count(*)::int from public.email_audit_log where entity_type = 'template_version' and details ->> 'template_id' = $1", [template]), 1);
    });
  } finally {
    await db.exec(original);
  }
  assert.equal((await asUser(A_FOUNDER, () => rpc.validate("x", null, content(paragraph("{{custom.racefield}}"))))).detail,
    "block 1: unknown merge tag: custom.racefield", "original validation restored");
});

test("header rules: the column CHECK alone enforces the same subject/preheader rules as the validator", async () => {
  // With the insert guard disabled (inside a rolled-back transaction), the
  // table CHECK is the last line of defence for every role; it must use the
  // same shared helper as the validator, not a weaker copy.
  const latest = (await one("select latest_version from public.email_templates where id = $1", [s.template])).latest_version;
  const insert = (subject, preheader) => db.query(`insert into public.email_template_versions
      (organization_id, template_id, version_number, subject, preheader, content, content_sha256, merge_tag_count, merge_tags_sha256, created_by)
    values ($1, $2, $3, $4, $5, '{"version":"email-content.v1","blocks":[{"type":"divider"}]}', repeat('0', 64), 0, repeat('0', 64), $6)`,
  [ORG_A, s.template, latest + 1, subject, preheader, A_FOUNDER]);
  for (const [subject, preheader] of [["=?UTF-8?B?4oCu?=", null], ["<b>Hola</b>", null], ["Hola", "=?UTF-8?Q?x?="], ["Hola", "<i>x"],
    [`Hola${U(0x2800)}`, null], [" Hola", null], ["x".repeat(201), null]]) {
    await db.exec("begin; alter table public.email_template_versions disable trigger email_template_versions_guard;");
    try {
      await assert.rejects(insert(subject, preheader), /check constraint/, j([subject, preheader]));
    } finally {
      await db.exec("rollback");
    }
  }
  const [fromHelper, fromValidator] = [
    await one("select private.email_header_text_problem('=?x', 200) as p"),
    await asUser(A_FOUNDER, () => rpc.validate("=?x", null, MINIMAL)),
  ];
  assert.equal(`subject: ${fromHelper.p}`, fromValidator.detail, "one helper produces the validator's reason");
});

test("L5: the audit actor and created_by can never disagree on a version insert", async () => {
  const latest = async () => (await one("select latest_version from public.email_templates where id = $1", [s.template])).latest_version;
  const insertAs = (sub, createdBy, number) => db.query(`
    select set_config('request.jwt.claim.sub', $1, true);
    `, [sub]).then(() => db.query(`insert into public.email_template_versions (organization_id, template_id, version_number, subject, content, content_sha256, created_by)
      values ($1, $2, $3, 'Actor', '{"version":"email-content.v1","blocks":[{"type":"divider"}]}', repeat('0', 64), $4) returning id`,
    [ORG_A, s.template, number, createdBy]));
  // A session acting as one user cannot record another user as the author.
  await db.exec("begin");
  try {
    await rejectsWith(insertAs(A_ADMIN, A_FOUNDER, (await latest()) + 1), "EMAIL_ACTOR_MISMATCH");
  } finally {
    await db.exec("rollback");
  }
  // With a session actor, created_by must match and the audit names that actor.
  await db.exec("begin");
  let matching;
  try {
    matching = (await insertAs(A_ADMIN, A_ADMIN, (await latest()) + 1)).rows[0].id;
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  const audit = await one("select actor_type, actor_user_id, details from public.email_audit_log where entity_id = $1", [matching]);
  assert.deepEqual([audit.actor_type, audit.actor_user_id, audit.details.created_by], ["user", A_ADMIN, A_ADMIN]);
  // Without a session actor (owner/maintenance path) the audit is 'system' and records created_by as evidence.
  const system = (await insertAs("", A_FOUNDER, (await latest()) + 1)).rows[0].id;
  const systemAudit = await one("select actor_type, actor_user_id, details from public.email_audit_log where entity_id = $1", [system]);
  assert.deepEqual([systemAudit.actor_type, systemAudit.actor_user_id, systemAudit.details.created_by], ["system", null, A_FOUNDER]);
  s.systemVersions = [s.ownerVersion, system];
});

test("M4: every Inc3b renderer vector is a valid template and fully specified", async () => {
  const render = JSON.parse(readFileSync(resolve(here, "fixtures/email_render_v1_cases.json"), "utf8"));
  assert.equal(render.format, "email-render.v1");
  assert.ok(render.cases.length >= 27);
  for (const required of ["Unicode line separators U+0085, U+2028 and U+2029 are line breaks, not deletions",
    "preheader longer than 500 code points after substitution fails the render",
    "heading longer than 1000 code points after substitution fails the render",
    "button text longer than 200 code points after substitution fails the render", "fields exactly at their limits render",
    "evaluation order: an empty subject is reported before a too-long block", "evaluation order: the subject is checked before the blocks"]) {
    assert.ok(render.cases.some((c) => c.name === required), required);
  }
  await asUser(A_FOUNDER, async () => {
    for (const [key, type] of [["score", "number"], ["limit", "number"], ["vip", "boolean"], ["birthday", "date"]]) {
      await rpc.createField(key, key, type);
    }
  });
  for (const required of ["number custom field renders its PostgreSQL text form (no reformatting)",
    "boolean and date custom fields render as true/false and YYYY-MM-DD", "blank value is absent: the fallback is used",
    "value that is empty after normalization is absent: the fallback is used", "TAB becomes a space and a lone CR is a line break",
    "subject longer than 400 code points after substitution fails the render",
    "paragraph longer than 20000 code points after substitution fails the render"]) {
    assert.ok(render.cases.some((c) => c.name === required), required);
  }
  const names = render.cases.map((c) => c.name);
  for (const required of ["alt text with quotes cannot break out of the attribute", "substituted markup is escaped, never interpreted",
    "paragraph: newlines from template and from values become line breaks", "empty subject after substitution fails the render for that contact",
    "subject: an encoded-word marker formed across a template/value boundary is neutralized",
    "single-line fields: value newlines become one space; CR and forbidden characters are removed",
    "empty preheader, heading, button and paragraph after substitution are omitted",
    "no heading, paragraph, button or image left after omissions fails the render"]) {
    assert.ok(names.includes(required), required);
  }
  await asUser(A_FOUNDER, async () => {
    for (const vector of render.cases) {
      const result = await rpc.validate(vector.template.subject, vector.template.preheader, vector.template.content);
      assert.equal(result.valid, true, `${vector.name}: template must be valid email-content.v1 (${j(result)})`);
      assert.ok(vector.values && vector.values.contact && vector.values.organization && vector.values.custom, vector.name);
      const e = vector.expected;
      assert.ok(["RENDER_EMPTY_SUBJECT", "RENDER_EMPTY_BODY"].includes(e.error)
        || (e.error === "RENDER_FIELD_TOO_LONG" && /^(subject|preheader|block [1-9][0-9]*)$/.test(e.location))
        || (e.error === "RENDER_UNSAFE_HEADER" && /^(subject|preheader)$/.test(e.location))
        || (typeof e.subject === "string" && e.subject.trim() !== "" && Array.isArray(e.blocks) && e.blocks.length > 0), vector.name);
      for (const value of [...Object.values(vector.values.contact), vector.values.organization.name, ...Object.values(vector.values.custom)]) {
        assert.ok(value === null || typeof value === "string", `${vector.name}: renderer inputs are server-resolved strings or null`);
      }
      if (!e.error) assert.ok(!/[\r\n]/.test(e.subject) && !e.subject.includes("=?"), `${vector.name}: expected subject is header-safe`);
    }
  });
});

test("pass 6: final rendered headers are checked by the SQL authority; exact limits are pinned", async () => {
  const render = JSON.parse(readFileSync(resolve(here, "fixtures/email_render_v1_cases.json"), "utf8"));
  // Plain substitution (no normalization) - enough for these vectors, whose values need none.
  const substitute = (text, values) => text.replace(/\{\{ *([a-z]+)\.([a-z0-9_]+) *(?:\|([^}]*))?\}\}/g, (_, ns, key, fallback) => {
    const value = ns === "organization" ? values.organization[key] : (values[ns] || {})[key];
    return value ?? (fallback ?? "").trim();
  });
  const safe = async (value) => (await one("select private.email_rendered_header_is_safe($1) as v", [value])).v;
  // M1: expected rendered headers are safe; RENDER_UNSAFE_HEADER vectors really assemble an unsafe header.
  for (const vector of render.cases) {
    const e = vector.expected;
    if (typeof e.subject === "string") assert.equal(await safe(e.subject), true, `${vector.name}: expected subject is header-safe`);
    if (typeof e.preheader_html === "string") assert.equal(await safe(e.preheader_html), true, `${vector.name}: expected preheader is header-safe`);
    if (e.error === "RENDER_UNSAFE_HEADER") {
      const field = e.location === "subject" ? vector.template.subject : vector.template.preheader;
      assert.equal(await safe(substitute(field, vector.values)), false, `${vector.name}: the assembled ${e.location} is unsafe`);
    }
  }
  // A substituted value can assemble an RFC 2047 encoded word in the final header.
  assert.equal(await safe(substitute("Hola {{contact.first_name}}", { contact: { first_name: "=?utf-8?B?QWRtaW4=?=" } })), false,
    "a final header carrying an encoded word is unsafe");
  assert.equal(await safe("Oferta: 2 = 2? Si"), true, "a lone '=' or '?' is not an encoded-word marker");
  assert.equal(await safe(`Hola${String.fromCodePoint(0x845b, 0xe0100)}`), false, "IVS in a final header is unsafe");
  assert.equal(await safe(`Hola ${String.fromCodePoint(0x2764, 0xfe0f)} ${String.fromCodePoint(0x200d)}`), true,
    "U+FE00-U+FE0F and ZWJ stay allowed in final headers");
  const bodyVector = render.cases.find((c) => c.name.startsWith("final header safety: the same variation selector"));
  assert.equal(await safe(bodyVector.expected.blocks[0].html), false, "the body value would be unsafe in a header...");
  assert.equal((await asUser(A_FOUNDER, () => rpc.validate("Hola", null, content(paragraph(bodyVector.expected.blocks[0].html))))).valid, true,
    "...but is valid body text");
  // LOW 3: limit = valid, limit + 1 = invalid, counted in code points.
  const limits = { subject: 400, preheader: 500, heading: 1000, button: 200, paragraph: 20000 };
  const fieldOf = (vector) => ({ subject: vector.template.subject, preheader: vector.template.preheader,
    ...Object.fromEntries(vector.template.content.blocks.filter((b) => b.text).map((b) => [b.type, b.text])) });
  for (const [field, limit] of Object.entries(limits)) {
    const prefix = field === "button" ? "button text" : field;
    const atLimit = render.cases.filter((c) => (c.name.startsWith(`${prefix} at exactly its limit`) || (field === "subject" && c.name === "fields exactly at their limits render")));
    const overLimit = render.cases.filter((c) => c.expected.error === "RENDER_FIELD_TOO_LONG" && c.name.startsWith(prefix)
      && (c.name.includes("one over") || c.name.includes(`longer than ${limit}`)));
    assert.ok(atLimit.length >= 1 && overLimit.length >= 1, `${field}: at-limit and over-limit vectors exist`);
    for (const vector of atLimit) {
      assert.equal([...substitute(fieldOf(vector)[field], vector.values)].length, limit, `${vector.name}: exactly ${limit} code points`);
      assert.equal(vector.expected.error, undefined, `${vector.name}: renders`);
    }
    assert.ok(overLimit.some((vector) => [...substitute(fieldOf(vector)[field], vector.values)].length === limit + 1),
      `${field}: a vector at exactly ${limit + 1} code points fails`);
  }
});

test("M2 (pass 4): server-side resolution of typed custom values matches the renderer vectors", async () => {
  // Contract section 7.1 step 0: a stored value becomes text with `value #>> '{}'`.
  const render = JSON.parse(readFileSync(resolve(here, "fixtures/email_render_v1_cases.json"), "utf8"));
  const numbers = render.cases.find((c) => c.name.startsWith("number custom field")).values.custom;
  const typed = render.cases.find((c) => c.name.startsWith("boolean and date")).values.custom;
  const contact = await asUser(A_FOUNDER, async () => {
    const id = (await rpc.createContact("typed@alpha.test", "Typed")).contact_id;
    // Raw JSON text so the textual numeric form (1.50) reaches PostgreSQL intact.
    await one("select public.email_set_contact_fields($1, $2::jsonb) as r",
      [id, `{"score": 1.50, "limit": 1e2, "vip": true, "birthday": "2026-09-29"}`]);
    return id;
  });
  const resolved = Object.fromEntries((await all(`select field.key, value.value #>> '{}' as text
    from public.email_contact_field_values as value
    join public.email_custom_field_definitions as field on field.organization_id = value.organization_id and field.id = value.field_id
    where value.contact_id = $1`, [contact])).map((r) => [r.key, r.text]));
  assert.deepEqual(resolved, { score: numbers.score, limit: numbers.limit, vip: typed.vip, birthday: typed.birthday });
});

// ---------------------------------------------------------------------------
// Authorization, tenant isolation, RLS and grants
// ---------------------------------------------------------------------------

const allCalls = () => [
  () => rpc.createDomain("x.example.com"), () => rpc.archiveDomain(s.domain),
  () => rpc.createIdentity(s.domain, "x", "X"), () => rpc.updateIdentity(s.identity, { from_name: "X" }),
  () => rpc.archiveIdentity(s.identity), () => rpc.createTemplate("x"), () => rpc.archiveTemplate(s.template),
  () => rpc.createVersion(s.template, "Hola", null, MINIMAL, 4), () => rpc.validate("Hola", null, MINIMAL),
];

test("area_lead, member, no-org, anon and service_role are denied every Increment 3a operation", async () => {
  assert.equal(allCalls().length, 9);
  const countsBefore = await tableCounts();
  for (const user of [A_LEAD, A_MEMBER, NO_ORG]) {
    await asUser(user, async () => {
      for (const call of allCalls()) await rejectsWith(call(), "EMAIL_ACCESS_DENIED");
      for (const table of NEW_TABLES) assert.equal(await count(`select count(*)::int from public.${table}`), 0, `${user} reads ${table}`);
    });
  }
  for (const runner of [asAnon, asService]) {
    await runner(async () => {
      for (const call of allCalls()) await assert.rejects(call(), /permission denied for function/);
    });
  }
  await asAnon(async () => {
    for (const table of NEW_TABLES) await assert.rejects(db.query(`select * from public.${table}`), /permission denied for table/);
  });
  assert.deepEqual(await tableCounts(), countsBefore, "denied calls change nothing");
});

test("tenant isolation: foreign ids are indistinguishable from unknown ids", async () => {
  await asUser(B_FOUNDER, async () => {
    await rejectsWith(rpc.archiveDomain(s.domain), "EMAIL_SENDER_DOMAIN_NOT_FOUND");
    await rejectsWith(rpc.createIdentity(s.domain, "hola", "Hack"), "EMAIL_SENDER_DOMAIN_NOT_FOUND");
    await rejectsWith(rpc.updateIdentity(s.identity, { from_name: "Hack" }), "EMAIL_SENDER_IDENTITY_NOT_FOUND");
    await rejectsWith(rpc.archiveIdentity(s.identity), "EMAIL_SENDER_IDENTITY_NOT_FOUND");
    await rejectsWith(rpc.archiveTemplate(s.template), "EMAIL_TEMPLATE_NOT_FOUND");
    await rejectsWith(rpc.createVersion(s.template, "Hola", null, MINIMAL, 4), "EMAIL_TEMPLATE_NOT_FOUND");
    // B's own active 'legacy' field is valid for B; A's 'plan' field is not.
    assert.equal((await rpc.validate("Hola", null, content(paragraph("{{custom.legacy}}")))).valid, true);
    assert.equal((await rpc.validate("Hola", null, content(paragraph("{{custom.plan}}")))).detail, "block 1: unknown merge tag: custom.plan");
    await rpc.createIdentity(s.bDomain, "hola", "B Co");
    s.bTemplate = (await rpc.createTemplate("Bienvenida")).template_id;
    await rpc.createVersion(s.bTemplate, "Hola B", null, MINIMAL, 0);
  });
  for (const [user, org] of [[A_FOUNDER, ORG_A], [B_FOUNDER, ORG_B]]) {
    await asUser(user, async () => {
      for (const table of NEW_TABLES) {
        const orgs = await all(`select distinct organization_id from public.${table}`);
        assert.ok(orgs.length > 0 && orgs.every((r) => r.organization_id === org), `${table} leaks to ${user}`);
      }
    });
  }
  for (const [sql, pattern] of [
    [`insert into public.email_sender_identities (organization_id, domain_id, local_part, address, from_name, created_by)
      values ('${ORG_B}', '${s.domain}', 'hola', 'hola@acme.example.com', 'Hack', '${B_FOUNDER}')`, /EMAIL_SENDER_DOMAIN_NOT_FOUND|foreign key/],
    [`insert into public.email_template_versions (organization_id, template_id, version_number, subject, content, content_sha256, created_by)
      values ('${ORG_B}', '${s.template}', 5, 'Hack', '{"version":"email-content.v1","blocks":[{"type":"divider"}]}', repeat('0', 64), '${B_FOUNDER}')`, /EMAIL_TEMPLATE_NOT_FOUND|foreign key/],
  ]) {
    await assert.rejects(db.query(sql), pattern, sql);
  }
  const fks = await all(`select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def from pg_constraint
    where contype = 'f' and conrelid::regclass::text = any($1::text[]) order by 1, 2`, [NEW_TABLES]);
  assert.deepEqual(fks.filter((fk) => !fk.def.includes("organizations(id)")).map((fk) => `${fk.tbl}: ${fk.def}`), [
    "email_sender_identities: FOREIGN KEY (organization_id, domain_id) REFERENCES email_sender_domains(organization_id, id) ON DELETE RESTRICT",
    "email_template_versions: FOREIGN KEY (organization_id, template_id) REFERENCES email_templates(organization_id, id) ON DELETE RESTRICT",
  ]);
});

test("direct DML is forbidden for authenticated and service_role", async () => {
  const statements = [
    `insert into public.email_sender_domains (organization_id, domain, created_by) values ('${ORG_A}', 'direct.example.com', '${A_FOUNDER}')`,
    `update public.email_sender_domains set status = 'archived'`,
    `delete from public.email_sender_domains`,
    `insert into public.email_sender_identities (organization_id, domain_id, local_part, address, from_name, created_by) values ('${ORG_A}', '${s.domain}', 'd', 'd@acme.example.com', 'D', '${A_FOUNDER}')`,
    `update public.email_sender_identities set from_name = 'Hack'`,
    `insert into public.email_templates (organization_id, name, created_by) values ('${ORG_A}', 'direct', '${A_FOUNDER}')`,
    `update public.email_templates set latest_version = 0`,
    `insert into public.email_template_versions (organization_id, template_id, version_number, subject, content, content_sha256, created_by) values ('${ORG_A}', '${s.template}', 5, 'x', '{}', repeat('0', 64), '${A_FOUNDER}')`,
    `update public.email_template_versions set subject = 'x'`,
    `delete from public.email_template_versions`,
    `truncate public.email_sender_domains, public.email_sender_identities, public.email_templates, public.email_template_versions`,
  ];
  for (const runner of [(cb) => asUser(A_FOUNDER, cb), asService]) {
    await runner(async () => {
      for (const sql of statements) await assert.rejects(db.query(sql), /permission denied/, sql);
    });
  }
});

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

test("audit: every mutation is recorded once, without plaintext addresses or content", async () => {
  const rows = await all(`select action, entity_type, entity_id, actor_type, actor_user_id, organization_id, details
    from public.email_audit_log where entity_type in ('sender_domain', 'sender_identity', 'template', 'template_version') order by id`);
  const actions = new Set(rows.map((r) => r.action));
  for (const action of ["email.sender_domain.created", "email.sender_domain.archived", "email.sender_identity.created",
    "email.sender_identity.updated", "email.sender_identity.archived", "email.template.created", "email.template.archived",
    "email.template_version.created"]) {
    assert.ok(actions.has(action), action);
  }
  for (const row of rows) {
    const text = j(row.details);
    assert.ok(!text.includes("@"), `${row.action} leaks an address: ${text}`);
    assert.ok(!/Bienvenido|Hola|Novedades|Segunda|Tu plan|amigo|Codigo/.test(text), `${row.action} leaks content: ${text}`);
  }
  // Every row created through an RPC carries the caller; only the owner insert is 'system'.
  const system = rows.filter((r) => r.actor_type === "system");
  assert.deepEqual(system.map((r) => [r.action, r.entity_id]), s.systemVersions.map((id) => ["email.template_version.created", id]),
    "direct owner inserts without a session actor are audited, as system");
  for (const row of rows.filter((r) => r.actor_type === "user")) {
    assert.ok([A_FOUNDER, A_ADMIN, B_FOUNDER].includes(row.actor_user_id), row.action);
  }
  // Exactly one audit row per version, whatever the path.
  const versions = await all("select id, organization_id from public.email_template_versions");
  for (const version of versions) {
    const matching = rows.filter((r) => r.entity_type === "template_version" && r.entity_id === version.id);
    assert.equal(matching.length, 1, `version ${version.id} audited exactly once`);
    assert.equal(matching[0].organization_id, version.organization_id);
  }
  assert.equal(rows.filter((r) => r.entity_type === "template_version").length, versions.length);

  const versionAudit = rows.find((r) => r.entity_id === s.v1.version_id);
  assert.deepEqual(versionAudit.details, {
    template_id: s.template, version_number: 1, content_sha256: s.v1.content_sha256, block_count: 2,
    merge_tag_count: 2, merge_tags_sha256: await sha256Hex(`["contact.first_name", "custom.plan"]`), created_by: A_FOUNDER,
  });
  // The bounded evidence is stored on the immutable row and the audit repeats it.
  for (const version of await all("select id, merge_tag_count, merge_tags_sha256 from public.email_template_versions")) {
    const audit = rows.find((r) => r.entity_id === version.id);
    assert.equal(audit.details.merge_tag_count, version.merge_tag_count);
    assert.equal(audit.details.merge_tags_sha256, version.merge_tags_sha256);
  }

  const identityCreated = rows.find((r) => r.action === "email.sender_identity.created" && r.entity_id === s.identity);
  assert.deepEqual(identityCreated.details, {
    domain_id: s.domain,
    address_hash: await sha256Hex("hola@acme.example.com"),
    reply_to_hash: await sha256Hex("soporte@acme.example.com"),
  });
  const identityUpdates = rows.filter((r) => r.action === "email.sender_identity.updated" && r.entity_id === s.identity);
  assert.deepEqual(identityUpdates.map((r) => r.details), [
    { changed_fields: ["from_name"], version: 2 },
    { changed_fields: ["reply_to"], version: 3, reply_to_cleared: true },
    { changed_fields: ["reply_to"], version: 4, reply_to_hash: await sha256Hex("ventas@acme.example.com") },
  ]);
});

// ---------------------------------------------------------------------------
// Increment 1-2 regression with Increment 3a applied
// ---------------------------------------------------------------------------

test("regression: Increment 1 consent, suppression and sendability still behave identically", async () => {
  await asUser(A_FOUNDER, async () => {
    s.ana = (await rpc.createContact("ana@alpha.test", "Ana")).contact_id;
    s.ben = (await rpc.createContact("ben@alpha.test", "Ben")).contact_id;
    await rpc.grant(s.ana);
    await rpc.grant(s.ben);
    await rpc.revoke(s.ben);
    await assert.rejects(db.query("select private.email_can('read')"), /permission denied/);
    await assert.rejects(db.query(`select * from private.email_is_sendable('${ORG_A}', '${s.ana}')`), /permission denied/);
  });
  assert.equal((await one("select * from private.email_is_sendable($1, $2)", [ORG_A, s.ana])).reason_code, "SENDABLE");
  assert.equal((await one("select * from private.email_is_sendable($1, $2)", [ORG_A, s.ben])).reason_code, "SUPPRESSED");
  await assert.rejects(db.query("update public.email_contact_consents set method = 'verbal'"), /EMAIL_CONSENT_LEDGER_APPEND_ONLY/);
  await assert.rejects(
    db.query(`insert into public.email_audit_log (organization_id, actor_type, action, entity_type, entity_id) values ('${ORG_A}', 'system', 'email.x.y', 'campaign', gen_random_uuid())`),
    /check constraint/, "campaign entity type is not accepted yet");
  assert.equal((await one("select private.email_can('manage_audiences') as v")).v, false);
});

test("regression: Increment 2 lists, segments and preview still behave identically", async () => {
  await asUser(A_FOUNDER, async () => {
    const list = (await rpc.createList("VIP")).list_id;
    assert.deepEqual(await rpc.addMembers(list, [s.ana, s.ben]), { added: 2, already_member: 0, skipped_archived: 0, skipped_not_found: 0 });
    const preview = await rpc.preview({ version: "segment.v1", match: "all", rules: [{ type: "list", op: "in", list_id: list }] });
    assert.equal(preview.matched, 2);
    assert.equal(preview.sendable, 1);
    assert.deepEqual(preview.not_sendable_by_reason, { SUPPRESSED: 1 });
    await assert.rejects(rpc.preview({ version: "segment.v1", match: "all", rules: [{ type: "tag", op: "has", tag_id: s.template }] }),
      /EMAIL_INVALID_SEGMENT/, "a template id is not a tag");
  });
  await asUser(A_MEMBER, () => assert.rejects(rpc.createList("x"), /EMAIL_ACCESS_DENIED/));
});
