// Email Marketing V1 — Increment 1 integration tests (PGlite).
//
// PGlite is intentionally not a project dependency. Run with an ephemeral npx:
//   npx -y -p @electric-sql/pglite node supabase/tests/email_marketing_v1_foundation.integration.mjs

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

async function loadPGlite() {
  try {
    return await import("@electric-sql/pglite");
  } catch {
    // Resolve from the ephemeral npx install that is on PATH.
    for (const dir of (process.env.PATH || "").split(delimiter)) {
      if (!dir.includes("_npx")) continue;
      try {
        const require = createRequire(join(dir, "..", "noop.js"));
        return await import(pathToFileURL(require.resolve("@electric-sql/pglite")).href);
      } catch {
        // try the next PATH entry
      }
    }
  }
  throw new Error("PGlite not found. Run with: npx -y -p @electric-sql/pglite node <this file>");
}

const { PGlite } = await loadPGlite();
const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  resolve(here, "../migrations/20260926160000_email_marketing_v1_foundation.sql"),
  "utf8",
);

const db = new PGlite();

// Minimal Supabase-like environment. Default privileges mirror Supabase, which
// grants everything on new public tables to the API roles; the migration must
// revoke them explicitly.
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant anon, authenticated, service_role to current_user;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create schema auth;
  create schema private;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create table public.organizations (id uuid primary key, name text not null);
  create table public.organization_memberships (
    user_id uuid not null references auth.users(id) on delete cascade,
    organization_id uuid not null references public.organizations(id) on delete cascade,
    role text not null check (role in ('founder', 'admin', 'area_lead', 'member')),
    primary key (user_id, organization_id)
  );
  create table public.user_active_organizations (
    user_id uuid primary key references auth.users(id) on delete cascade,
    organization_id uuid not null,
    foreign key (user_id, organization_id)
      references public.organization_memberships(user_id, organization_id) on delete cascade
  );
  -- Same definition as production (20260816120000).
  create function public.current_user_organization_id()
  returns uuid language sql stable security definer set search_path = '' as $$
    select active.organization_id
    from public.user_active_organizations as active
    join public.organization_memberships as membership
      on membership.user_id = active.user_id
     and membership.organization_id = active.organization_id
    where active.user_id = (select auth.uid());
  $$;
`);

await db.exec(migration);

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A_FOUNDER = "a0000000-0000-4000-8000-000000000001";
const A_ADMIN = "a0000000-0000-4000-8000-000000000002";
const A_LEAD = "a0000000-0000-4000-8000-000000000003";
const A_MEMBER = "a0000000-0000-4000-8000-000000000004";
const B_FOUNDER = "b0000000-0000-4000-8000-000000000001";
const MULTI = "c0000000-0000-4000-8000-000000000001"; // member of A, founder of B
const NO_ORG = "d0000000-0000-4000-8000-000000000001";
const PAST = "2026-09-01T10:00:00Z";

await db.exec(`
  insert into auth.users(id) values
    ('${A_FOUNDER}'), ('${A_ADMIN}'), ('${A_LEAD}'), ('${A_MEMBER}'),
    ('${B_FOUNDER}'), ('${MULTI}'), ('${NO_ORG}');
  insert into public.organizations(id, name) values ('${ORG_A}', 'A'), ('${ORG_B}', 'B');
  insert into public.organization_memberships(user_id, organization_id, role) values
    ('${A_FOUNDER}', '${ORG_A}', 'founder'),
    ('${A_ADMIN}', '${ORG_A}', 'admin'),
    ('${A_LEAD}', '${ORG_A}', 'area_lead'),
    ('${A_MEMBER}', '${ORG_A}', 'member'),
    ('${B_FOUNDER}', '${ORG_B}', 'founder'),
    ('${MULTI}', '${ORG_A}', 'member'),
    ('${MULTI}', '${ORG_B}', 'founder');
  insert into public.user_active_organizations(user_id, organization_id) values
    ('${A_FOUNDER}', '${ORG_A}'), ('${A_ADMIN}', '${ORG_A}'), ('${A_LEAD}', '${ORG_A}'),
    ('${A_MEMBER}', '${ORG_A}'), ('${B_FOUNDER}', '${ORG_B}'), ('${MULTI}', '${ORG_A}');
`);

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
// Trusted server-side caller (migration owner) for private.email_is_sendable.
const asOwner = (callback) => callback();

async function one(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0];
}
async function count(sql, params = []) {
  return (await one(sql, params)).count;
}

const createContact = (email, extra = {}) =>
  one(
    "select * from public.email_create_contact($1, $2, $3, $4, $5, $6)",
    [email, extra.first_name ?? null, extra.last_name ?? null, extra.locale ?? null, extra.timezone ?? null, extra.source ?? "manual"],
  );
const grantConsent = (contactId, overrides = {}) =>
  one(
    "select * from public.email_record_consent($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      contactId,
      overrides.method ?? "manual_entry",
      "source" in overrides ? overrides.source : "Evento presencial 2026",
      "text" in overrides ? overrides.text : "Acepto recibir comunicaciones comerciales por email.",
      "version" in overrides ? overrides.version : "v1",
      overrides.occurred_at ?? PAST,
      overrides.evidence ?? {},
      overrides.purpose ?? "marketing",
      overrides.key ?? null,
    ],
  );
const revokeConsent = (contactId, overrides = {}) =>
  one(
    "select * from public.email_revoke_consent($1, $2, $3, $4, $5, $6)",
    [contactId, overrides.method ?? "user_request", overrides.reason ?? null, overrides.occurred_at ?? null, overrides.purpose ?? "marketing", overrides.key ?? null],
  );
const addSuppression = (email, reason, note = null) =>
  one("select * from public.email_add_suppression($1, $2, $3)", [email, reason, note]);
const liftSuppression = (id, reason) =>
  one("select * from public.email_lift_suppression($1, $2)", [id, reason]);
const sendable = (orgId, contactId, purpose = "marketing") =>
  one("select * from private.email_is_sendable($1, $2, $3)", [orgId, contactId, purpose]);

const state = {};

// ---------------------------------------------------------------------------
test("migration: RLS enabled, SECURITY DEFINER functions pin search_path", async () => {
  const rls = await db.query(`
    select relname, relrowsecurity from pg_class
    where relname in ('email_audit_log','email_contacts','email_contact_consents','email_suppressions')
    order by relname`);
  assert.equal(rls.rows.length, 4);
  for (const row of rls.rows) assert.equal(row.relrowsecurity, true, row.relname);

  const unsafe = await db.query(`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.proname like 'email\\_%'
      and (p.proconfig is null or not ('search_path=""' = any(p.proconfig)))`);
  assert.deepEqual(unsafe.rows, [], "every email function must set search_path = ''");

  const spoofableArgs = await db.query(`
    select p.proname, a.arg from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
      unnest(coalesce(p.proargnames, array[]::text[])) as a(arg)
    where n.nspname = 'public' and p.proname like 'email\\_%'
      and (a.arg ilike '%organization%' or a.arg ilike '%actor%' or a.arg ilike '%user%'
           or a.arg ilike '%recorded_by%' or a.arg ilike '%created_by%')`);
  assert.deepEqual(spoofableArgs.rows, [], "RPCs must not accept organization or actor identity");
});

test("normalization: canonical form and rejection of invalid addresses", async () => {
  const norm = async (value) => (await one("select private.email_normalize_address($1) as v", [value])).v;
  assert.equal(await norm("  John.Doe+Promo@Example.COM \n"), "john.doe+promo@example.com");
  assert.equal(await norm("x@sub.example.co"), "x@sub.example.co");
  assert.equal(await norm("user@xn--bcher-kva.example"), "user@xn--bcher-kva.example");
  for (const bad of [
    "", "   ", "no-at-sign", "a@b", "a..b@example.com", ".a@example.com", "a.@example.com",
    "a@-example.com", "a@example-.com", "ñandu@example.com", "a@b@example.com", "a b@example.com",
    "a@example.123", `${"a".repeat(65)}@example.com`, `a@${"b".repeat(250)}.com`, "a@example..com",
  ]) {
    assert.equal(await norm(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(await norm(null), null);
});

test("founder creates a contact; organization and actor are derived server-side", async () => {
  const created = await asUser(A_FOUNDER, () =>
    createContact("  Ana.Perez@Example.com ", { first_name: " Ana ", locale: "es-MX", timezone: "America/Mexico_City" }));
  assert.equal(created.was_created, true);
  state.anaA = created.contact_id;

  const row = await one("select * from public.email_contacts where id = $1", [created.contact_id]);
  assert.equal(row.organization_id, ORG_A);
  assert.equal(row.created_by, A_FOUNDER);
  assert.equal(row.email, "Ana.Perez@Example.com");
  assert.equal(row.email_normalized, "ana.perez@example.com");
  assert.equal(row.first_name, "Ana");
  assert.equal(row.status, "active");
  assert.equal(Number(row.version), 1);

  const audit = await one("select * from public.email_audit_log where entity_id = $1", [created.contact_id]);
  assert.equal(audit.action, "email.contact.created");
  assert.equal(audit.organization_id, ORG_A);
  assert.equal(audit.actor_type, "user");
  assert.equal(audit.actor_user_id, A_FOUNDER);
  assert.equal(audit.details.address_hash.length, 64);
  assert.ok(!JSON.stringify(audit.details).includes("ana.perez"), "audit must not store the raw address");
});

test("admin is authorized in Increment 1", async () => {
  const created = await asUser(A_ADMIN, () => createContact("admin-created@example.com"));
  assert.equal(created.was_created, true);
  state.adminCreatedA = created.contact_id;
});

test("duplicate normalized address returns the existing contact without modifying it", async () => {
  const auditBefore = await count("select count(*)::int from public.email_audit_log");
  const again = await asUser(A_ADMIN, () => createContact("ANA.PEREZ@EXAMPLE.COM", { first_name: "Otra" }));
  assert.equal(again.contact_id, state.anaA);
  assert.equal(again.was_created, false);
  const row = await one("select first_name, version from public.email_contacts where id = $1", [state.anaA]);
  assert.equal(row.first_name, "Ana");
  assert.equal(Number(row.version), 1);
  assert.equal(await count("select count(*)::int from public.email_audit_log"), auditBefore);
  assert.equal(await count("select count(*)::int from public.email_contacts where email_normalized = 'ana.perez@example.com' and organization_id = $1", [ORG_A]), 1);
});

test("same address in another organization is an independent contact", async () => {
  const created = await asUser(B_FOUNDER, () => createContact("ana.perez@example.com"));
  assert.equal(created.was_created, true);
  assert.notEqual(created.contact_id, state.anaA);
  state.anaB = created.contact_id;
  const row = await one("select organization_id from public.email_contacts where id = $1", [created.contact_id]);
  assert.equal(row.organization_id, ORG_B);
});

test("create_contact validates arguments", async () => {
  await asUser(A_FOUNDER, async () => {
    await assert.rejects(createContact("not-an-email"), /EMAIL_INVALID_ADDRESS/);
    await assert.rejects(createContact(null), /EMAIL_INVALID_ADDRESS/);
    await assert.rejects(createContact("v1@example.com", { source: "builder_form" }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(createContact("v2@example.com", { timezone: "Mars/Olympus" }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(createContact("v3@example.com", { locale: "ES_mx" }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(createContact("v4@example.com", { first_name: "x".repeat(101) }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(createContact("v5@example.com", { first_name: "bad\u0007name" }), /EMAIL_INVALID_ARGUMENT/);
  });
  assert.equal(await count("select count(*)::int from public.email_contacts where email_normalized like 'v_@example.com'"), 0);
});

test("area_lead, member, users without active org, and anon are denied everywhere", async () => {
  const calls = [
    () => createContact("denied@example.com"),
    () => one("select * from public.email_update_contact($1, $2)", [state.anaA, { first_name: "X" }]),
    () => one("select * from public.email_archive_contact($1)", [state.anaA]),
    () => grantConsent(state.anaA),
    () => revokeConsent(state.anaA),
    () => addSuppression("denied@example.com", "manual"),
    () => liftSuppression("00000000-0000-4000-8000-000000000000", "a sufficiently long reason"),
  ];
  for (const user of [A_LEAD, A_MEMBER, MULTI, NO_ORG]) {
    await asUser(user, async () => {
      for (const call of calls) await assert.rejects(call(), /EMAIL_ACCESS_DENIED/, `user ${user}`);
      for (const table of ["email_contacts", "email_contact_consents", "email_suppressions", "email_audit_log"]) {
        assert.equal(await count(`select count(*)::int from public.${table}`), 0, `${user} must not read ${table}`);
      }
    });
  }
  await asUser(null, async () => {
    for (const call of calls) await assert.rejects(call(), /EMAIL_ACCESS_DENIED/);
  });
  await asAnon(async () => {
    for (const call of calls) await assert.rejects(call(), /permission denied for function/);
    for (const table of ["email_contacts", "email_contact_consents", "email_suppressions", "email_audit_log"]) {
      await assert.rejects(db.query(`select * from public.${table}`), /permission denied for table/);
    }
  });
  assert.equal(await count("select count(*)::int from public.email_contacts where email_normalized = 'denied@example.com'"), 0);
});

test("active organization governs access for multi-organization users", async () => {
  // MULTI is a member in A (active) and founder in B. Switching to B grants B only.
  await db.exec(`update public.user_active_organizations set organization_id = '${ORG_B}' where user_id = '${MULTI}'`);
  const created = await asUser(MULTI, () => createContact("multi-created@example.com"));
  const row = await one("select organization_id, created_by from public.email_contacts where id = $1", [created.contact_id]);
  assert.equal(row.organization_id, ORG_B);
  assert.equal(row.created_by, MULTI);
  await asUser(MULTI, async () => {
    assert.equal(await count("select count(*)::int from public.email_contacts where organization_id = $1", [ORG_A]), 0);
    await assert.rejects(
      one("select * from public.email_update_contact($1, $2)", [state.anaA, { first_name: "Hack" }]),
      /EMAIL_CONTACT_NOT_FOUND/,
    );
  });
  await db.exec(`update public.user_active_organizations set organization_id = '${ORG_A}' where user_id = '${MULTI}'`);
  await asUser(MULTI, () => assert.rejects(createContact("multi-2@example.com"), /EMAIL_ACCESS_DENIED/));
});

test("cross-tenant SELECT is denied in both directions", async () => {
  const seenByA = await asUser(A_FOUNDER, () => db.query("select distinct organization_id from public.email_contacts"));
  assert.deepEqual(seenByA.rows.map((r) => r.organization_id), [ORG_A]);
  const seenByB = await asUser(B_FOUNDER, () => db.query("select distinct organization_id from public.email_contacts"));
  assert.deepEqual(seenByB.rows.map((r) => r.organization_id), [ORG_B]);
  await asUser(B_FOUNDER, async () => {
    assert.equal(await count("select count(*)::int from public.email_contacts where id = $1", [state.anaA]), 0);
    assert.equal(await count("select count(*)::int from public.email_audit_log where organization_id = $1", [ORG_A]), 0);
  });
});

test("forbidden direct DML for authenticated and service_role", async () => {
  const statements = [
    [`insert into public.email_contacts (organization_id, email, email_normalized, source, created_by) values ('${ORG_A}', 'x@example.com', 'x@example.com', 'manual', '${A_FOUNDER}')`],
    [`update public.email_contacts set first_name = 'Hack' where id = '${state.anaA}'`],
    [`delete from public.email_contacts where id = '${state.anaA}'`],
    [`insert into public.email_suppressions (organization_id, email_normalized, reason, source, actor_type, created_by) values ('${ORG_A}', 'x@example.com', 'manual', 'manual', 'user', '${A_FOUNDER}')`],
    [`update public.email_suppressions set lifted_at = now()`],
    [`delete from public.email_suppressions`],
    [`insert into public.email_audit_log (organization_id, actor_type, action, entity_type, entity_id) values ('${ORG_A}', 'system', 'email.contact.created', 'contact', '${state.anaA}')`],
    [`update public.email_audit_log set details = '{}'`],
    [`delete from public.email_audit_log`],
    [`update public.email_contact_consents set action = 'granted'`],
    [`delete from public.email_contact_consents`],
    [`truncate public.email_contacts, public.email_contact_consents, public.email_suppressions, public.email_audit_log`],
  ];
  for (const runner of [(cb) => asUser(A_FOUNDER, cb), asService]) {
    await runner(async () => {
      for (const [sql] of statements) {
        await assert.rejects(db.query(sql), /permission denied/, sql);
      }
    });
  }
  const row = await one("select first_name from public.email_contacts where id = $1", [state.anaA]);
  assert.equal(row.first_name, "Ana");
});

test("private helpers are not callable by API roles", async () => {
  for (const runner of [(cb) => asUser(A_FOUNDER, cb), asAnon]) {
    await runner(async () => {
      await assert.rejects(db.query("select private.email_can('read')"), /permission denied/);
      await assert.rejects(sendable(ORG_A, state.anaA), /permission denied/);
      await assert.rejects(
        db.query("select private.email_write_audit($1, 'email.contact.created', 'contact', $2)", [ORG_A, state.anaA]),
        /permission denied/,
      );
    });
  }
  await asService(async () => {
    await assert.rejects(
      db.query("select private.email_write_audit($1, 'email.contact.created', 'contact', $2)", [ORG_A, state.anaA]),
      /permission denied/,
    );
    await assert.rejects(sendable(ORG_A, state.anaA), /permission denied/);
  });
  assert.equal((await one("select private.email_can('drop_everything') as v")).v, false, "unknown actions fail closed");
});

test("update_contact: validation, versioning, audit and state rules", async () => {
  await asUser(A_FOUNDER, async () => {
    const updated = await one("select * from public.email_update_contact($1, $2, $3)", [state.anaA, { last_name: "Pérez", first_name: null }, 1]);
    assert.equal(updated.last_name, "Pérez");
    assert.equal(updated.first_name, null);
    assert.equal(Number(updated.version), 2);

    await assert.rejects(one("select * from public.email_update_contact($1, $2, $3)", [state.anaA, { first_name: "X" }, 1]), /EMAIL_CONTACT_VERSION_CONFLICT/);
    await assert.rejects(one("select * from public.email_update_contact($1, $2)", [state.anaA, { email: "new@example.com" }]), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(one("select * from public.email_update_contact($1, $2)", [state.anaA, { organization_id: ORG_B }]), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(one("select * from public.email_update_contact($1, $2)", [state.anaA, { first_name: 42 }]), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(one("select * from public.email_update_contact($1, $2)", [state.anaA, {}]), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(one("select * from public.email_update_contact($1, $2)", [state.anaA, [1]]), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(one("select * from public.email_update_contact($1, $2)", [state.anaA, { timezone: "Nowhere/City" }]), /EMAIL_INVALID_ARGUMENT/);

    const noop = await one("select * from public.email_update_contact($1, $2)", [state.anaA, { last_name: "Pérez" }]);
    assert.equal(Number(noop.version), 2, "no-op update must not bump version");
  });
  const audits = await db.query("select details from public.email_audit_log where entity_id = $1 and action = 'email.contact.updated'", [state.anaA]);
  assert.equal(audits.rows.length, 1);
  assert.deepEqual(audits.rows[0].details.changed_fields.sort(), ["first_name", "last_name"]);
});

test("sendability fails closed without consent", async () => {
  const result = await asOwner(() => sendable(ORG_A, state.anaA));
  assert.equal(result.sendable, false);
  assert.equal(result.reason_code, "CONSENT_MISSING");
});

test("consent grant requires complete evidence and an allowed method", async () => {
  await asUser(A_FOUNDER, async () => {
    await assert.rejects(grantConsent(state.anaA, { text: null }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(grantConsent(state.anaA, { text: "   " }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(grantConsent(state.anaA, { version: null }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(grantConsent(state.anaA, { source: "" }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(grantConsent(state.anaA, { method: "double_opt_in_confirmation" }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(grantConsent(state.anaA, { method: "unsubscribe_link" }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(grantConsent(state.anaA, { purpose: "transactional" }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(grantConsent(state.anaA, { occurred_at: "2099-01-01T00:00:00Z" }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(grantConsent(state.anaA, { occurred_at: "1999-01-01T00:00:00Z" }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(grantConsent(state.anaA, { evidence: [1, 2] }), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(grantConsent(state.anaA, { key: "short" }), /EMAIL_INVALID_ARGUMENT/);
  });
  assert.equal(await count("select count(*)::int from public.email_contact_consents"), 0);
});

test("consent grant makes a clean contact sendable", async () => {
  const granted = await asUser(A_FOUNDER, () =>
    grantConsent(state.anaA, { method: "written", evidence: { document: "form-2026-001" } }));
  assert.equal(granted.was_created, true);
  state.anaGrant = granted.consent_id;
  const row = await one("select * from public.email_contact_consents where id = $1", [granted.consent_id]);
  assert.equal(row.organization_id, ORG_A);
  assert.equal(row.recorded_by, A_FOUNDER);
  assert.equal(row.email_normalized, "ana.perez@example.com");
  assert.equal(row.consent_text_version, "v1");
  const result = await asOwner(() => sendable(ORG_A, state.anaA));
  assert.deepEqual({ ...result }, { sendable: true, reason_code: "SENDABLE", suppression_reason: null, consent_id: granted.consent_id });
});

test("sendability is organization-scoped and validates its inputs", async () => {
  await asOwner(async () => {
    assert.equal((await sendable(ORG_B, state.anaA)).reason_code, "CONTACT_NOT_FOUND");
    assert.equal((await sendable(ORG_A, state.anaA, "transactional")).reason_code, "INVALID_REQUEST");
    assert.equal((await sendable(null, state.anaA)).reason_code, "INVALID_REQUEST");
    assert.equal((await sendable(ORG_A, null)).reason_code, "INVALID_REQUEST");
    assert.equal((await sendable(ORG_B, state.anaB)).reason_code, "CONSENT_MISSING", "consent in A must not leak into B");
  });
});

test("consent idempotency: identical replay returns original, divergent payload is rejected", async () => {
  const key = "import-batch-7:row-12";
  const first = await asUser(A_FOUNDER, () => grantConsent(state.adminCreatedA, { key, method: "import_attestation" }));
  assert.equal(first.was_created, true);
  // Replay from a session with a different TimeZone must still match.
  await db.exec("set timezone = 'Asia/Tokyo'");
  const replay = await asUser(A_ADMIN, () => grantConsent(state.adminCreatedA, { key, method: "import_attestation" }));
  await db.exec("reset timezone");
  assert.equal(replay.consent_id, first.consent_id);
  assert.equal(replay.was_created, false);
  await asUser(A_FOUNDER, () =>
    assert.rejects(grantConsent(state.adminCreatedA, { key, method: "import_attestation", version: "v2" }), /EMAIL_IDEMPOTENCY_CONFLICT/));
  assert.equal(await count("select count(*)::int from public.email_contact_consents where idempotency_key = $1", [key]), 1);
  // The same key is independent in another organization.
  const other = await asUser(B_FOUNDER, () => grantConsent(state.anaB, { key }));
  assert.equal(other.was_created, true);
  assert.notEqual(other.consent_id, first.consent_id);
});

test("consent revoke: fail closed, creates suppression, keeps history", async () => {
  const revoked = await asUser(A_FOUNDER, () => revokeConsent(state.anaA, { reason: "Pidió no recibir más", key: "revoke-ana-0001" }));
  assert.equal(revoked.was_created, true);
  assert.ok(revoked.suppression_id);
  state.anaUnsub = revoked.suppression_id;

  const suppression = await one("select * from public.email_suppressions where id = $1", [revoked.suppression_id]);
  assert.equal(suppression.reason, "unsubscribed");
  assert.equal(suppression.source, "consent_revocation");
  assert.equal(suppression.contact_id, state.anaA);
  assert.equal(suppression.organization_id, ORG_A);

  const result = await asOwner(() => sendable(ORG_A, state.anaA));
  assert.equal(result.sendable, false);
  assert.equal(result.reason_code, "SUPPRESSED");
  assert.equal(result.suppression_reason, "unsubscribed");

  const ledger = await db.query("select action from public.email_contact_consents where contact_id = $1 order by ledger_position", [state.anaA]);
  assert.deepEqual(ledger.rows.map((r) => r.action), ["granted", "revoked"]);

  const replay = await asUser(A_FOUNDER, () => revokeConsent(state.anaA, { reason: "Pidió no recibir más", key: "revoke-ana-0001" }));
  assert.equal(replay.consent_id, revoked.consent_id);
  assert.equal(replay.was_created, false);
  assert.equal(await count("select count(*)::int from public.email_suppressions where email_normalized = 'ana.perez@example.com' and organization_id = $1", [ORG_A]), 1);
});

test("revoked consent without suppression still fails closed", async () => {
  // Not reachable through RPCs (revoke always suppresses); verifies the ledger rule itself.
  const contact = await asUser(A_FOUNDER, () => createContact("ledger-only@example.com"));
  await asUser(A_FOUNDER, () => grantConsent(contact.contact_id));
  await db.query(`insert into public.email_contact_consents
    (organization_id, contact_id, email_normalized, purpose, action, method, occurred_at, actor_type)
    values ($1, $2, 'ledger-only@example.com', 'marketing', 'revoked', 'manual_entry', now(), 'system')`,
  [ORG_A, contact.contact_id]);
  const result = await asOwner(() => sendable(ORG_A, contact.contact_id));
  assert.equal(result.reason_code, "CONSENT_REVOKED");
});

test("grant with not-yet-effective occurrence time is not sendable", async () => {
  const contact = await asUser(A_FOUNDER, () => createContact("future@example.com"));
  const inTwoMinutes = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  await asUser(A_FOUNDER, () => grantConsent(contact.contact_id, { occurred_at: inTwoMinutes }));
  assert.equal((await asOwner(() => sendable(ORG_A, contact.contact_id))).reason_code, "CONSENT_EVIDENCE_INCOMPLETE");
});

test("consent ledger is append-only for every role, including the owner", async () => {
  for (const sql of [
    `update public.email_contact_consents set action = 'granted' where id = '${state.anaGrant}'`,
    `update public.email_contact_consents set consent_text = 'otro' where id = '${state.anaGrant}'`,
    `delete from public.email_contact_consents where id = '${state.anaGrant}'`,
    `truncate public.email_contact_consents`,
  ]) {
    await assert.rejects(db.query(sql), /EMAIL_CONSENT_LEDGER_APPEND_ONLY/, sql);
  }
  await assert.rejects(
    db.query(`insert into public.email_contact_consents
      (organization_id, contact_id, email_normalized, purpose, action, method, source, consent_text, consent_text_version, occurred_at, actor_type)
      values ($1, $2, 'someone-else@example.com', 'marketing', 'granted', 'manual_entry', 's', 't', 'v', now(), 'system')`, [ORG_A, state.adminCreatedA]),
    /EMAIL_CONSENT_ADDRESS_MISMATCH/,
  );
  await assert.rejects(
    db.query(`insert into public.email_contact_consents
      (organization_id, contact_id, email_normalized, purpose, action, method, occurred_at, actor_type)
      values ($1, $2, 'ana.perez@example.com', 'marketing', 'granted', 'manual_entry', now(), 'system')`, [ORG_A, state.anaA]),
    /check constraint/,
    "a grant without evidence is not representable",
  );
  await assert.rejects(
    db.query(`insert into public.email_contact_consents
      (organization_id, contact_id, email_normalized, purpose, action, method, occurred_at, actor_type)
      values ($1, $2, 'ana.perez@example.com', 'marketing', 'revoked', 'manual_entry', now(), 'system')`, [ORG_B, state.anaA]),
    /foreign key constraint|EMAIL_CONSENT_ADDRESS_MISMATCH/,
    "cross-tenant consent reference must fail",
  );
  assert.equal(await count("select count(*)::int from public.email_contact_consents where organization_id = $1 and contact_id = $2", [ORG_B, state.anaA]), 0);

  // The composite (organization_id, contact_id) foreign keys exist independently of the triggers.
  const foreignKeys = await db.query(`
    select conrelid::regclass::text as child, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where contype = 'f' and conrelid::regclass::text in ('email_contact_consents', 'email_suppressions')
      and confrelid = 'public.email_contacts'::regclass
    order by 1`);
  assert.deepEqual(foreignKeys.rows.map((r) => r.child), ["email_contact_consents", "email_suppressions"]);
  for (const row of foreignKeys.rows) {
    assert.match(row.definition, /FOREIGN KEY \(organization_id, contact_id\) REFERENCES (public\.)?email_contacts\(organization_id, id\)/);
  }
});

test("audit log is immutable for every role, including the owner", async () => {
  for (const sql of [
    "update public.email_audit_log set action = 'email.contact.updated'",
    "delete from public.email_audit_log",
    "truncate public.email_audit_log",
  ]) {
    await assert.rejects(db.query(sql), /EMAIL_AUDIT_IMMUTABLE/, sql);
  }
  const actors = await db.query("select distinct actor_user_id from public.email_audit_log where actor_type = 'user'");
  for (const row of actors.rows) {
    assert.ok([A_FOUNDER, A_ADMIN, B_FOUNDER, MULTI].includes(row.actor_user_id), "audit actor must be a real caller");
  }
});

test("cross-tenant mutation attempts fail and leave data intact", async () => {
  const before = await one("select * from public.email_contacts where id = $1", [state.anaA]);
  await asUser(B_FOUNDER, async () => {
    await assert.rejects(one("select * from public.email_update_contact($1, $2)", [state.anaA, { first_name: "Hack" }]), /EMAIL_CONTACT_NOT_FOUND/);
    await assert.rejects(one("select * from public.email_archive_contact($1)", [state.anaA]), /EMAIL_CONTACT_NOT_FOUND/);
    await assert.rejects(grantConsent(state.anaA), /EMAIL_CONTACT_NOT_FOUND/);
    await assert.rejects(revokeConsent(state.anaA), /EMAIL_CONTACT_NOT_FOUND/);
    await assert.rejects(liftSuppression(state.anaUnsub, "trying to lift another tenant"), /EMAIL_SUPPRESSION_NOT_FOUND/);
    // Suppressing the same address in B only affects B.
    const own = await addSuppression("ana.perez@example.com", "manual");
    const row = await one("select organization_id, contact_id from public.email_suppressions where id = $1", [own.suppression_id]);
    assert.equal(row.organization_id, ORG_B);
    assert.equal(row.contact_id, state.anaB);
  });
  const after = await one("select * from public.email_contacts where id = $1", [state.anaA]);
  assert.deepEqual(after, before);
  const aSuppression = await one("select lifted_at from public.email_suppressions where id = $1", [state.anaUnsub]);
  assert.equal(aSuppression.lifted_at, null);
  await assert.rejects(
    db.query(`insert into public.email_suppressions (organization_id, email_normalized, contact_id, reason, source, actor_type)
      values ($1, 'ana.perez@example.com', $2, 'manual', 'system', 'system')`, [ORG_B, state.anaA]),
    /foreign key constraint|EMAIL_SUPPRESSION_CONTACT_MISMATCH/,
  );
});

test("suppression creation is idempotent per active address", async () => {
  const first = await asUser(A_FOUNDER, () => addSuppression("  Bounce@Example.com", "hard_bounce", "Importado de proveedor anterior"));
  assert.equal(first.was_created, true);
  const again = await asUser(A_ADMIN, () => addSuppression("bounce@example.com", "manual"));
  assert.equal(again.suppression_id, first.suppression_id);
  assert.equal(again.was_created, false);
  const row = await one("select reason, contact_id from public.email_suppressions where id = $1", [first.suppression_id]);
  assert.equal(row.reason, "hard_bounce");
  assert.equal(row.contact_id, null);
  state.bounce = first.suppression_id;
  await asUser(A_FOUNDER, async () => {
    await assert.rejects(addSuppression("invalid", "manual"), /EMAIL_INVALID_ADDRESS/);
    await assert.rejects(addSuppression("ok@example.com", "because"), /EMAIL_INVALID_ARGUMENT/);
  });
});

test("suppression survives the contact lifecycle", async () => {
  // Address-level suppression existed before the contact.
  const contact = await asUser(A_FOUNDER, () => createContact("bounce@example.com"));
  await asUser(A_FOUNDER, () => grantConsent(contact.contact_id));
  let result = await asOwner(() => sendable(ORG_A, contact.contact_id));
  assert.equal(result.reason_code, "SUPPRESSED");
  assert.equal(result.suppression_reason, "hard_bounce");

  const archived = await asUser(A_FOUNDER, () => one("select * from public.email_archive_contact($1, $2)", [contact.contact_id, "Rebotaba"]));
  assert.equal(archived.status, "archived");
  const stillActive = await one("select lifted_at from public.email_suppressions where id = $1", [state.bounce]);
  assert.equal(stillActive.lifted_at, null);
  result = await asOwner(() => sendable(ORG_A, contact.contact_id));
  assert.equal(result.sendable, false);
  state.archivedBounceContact = contact.contact_id;
});

test("contact state transitions are validated", async () => {
  const id = state.archivedBounceContact;
  await asUser(A_FOUNDER, async () => {
    const again = await one("select * from public.email_archive_contact($1)", [id]);
    assert.equal(again.status, "archived", "archive is idempotent");
    await assert.rejects(one("select * from public.email_update_contact($1, $2)", [id, { first_name: "X" }]), /EMAIL_CONTACT_ARCHIVED/);
    await assert.rejects(grantConsent(id), /EMAIL_CONTACT_ARCHIVED/);
    await assert.rejects(createContact("BOUNCE@example.com"), /EMAIL_CONTACT_ARCHIVED/);
    const revoked = await revokeConsent(id, { method: "written" });
    assert.equal(revoked.was_created, true, "revocation is always accepted");
  });
  assert.equal(await count("select count(*)::int from public.email_audit_log where entity_id = $1 and action = 'email.contact.archived'", [id]), 1);
  for (const [sql, pattern] of [
    [`update public.email_contacts set status = 'active', archived_at = null, archived_by = null where id = '${id}'`, /EMAIL_CONTACT_ARCHIVED/],
    [`update public.email_contacts set email = 'changed@example.com', email_normalized = 'changed@example.com' where id = '${state.adminCreatedA}'`, /EMAIL_CONTACT_IDENTITY_IMMUTABLE/],
    [`update public.email_contacts set organization_id = '${ORG_B}' where id = '${state.adminCreatedA}'`, /EMAIL_CONTACT_IDENTITY_IMMUTABLE/],
    [`delete from public.email_contacts where id = '${state.adminCreatedA}'`, /EMAIL_CONTACT_DELETE_FORBIDDEN/],
    [`truncate public.email_contacts cascade`, /EMAIL_CONTACT_DELETE_FORBIDDEN|EMAIL_CONSENT_LEDGER_APPEND_ONLY|EMAIL_SUPPRESSION_DELETE_FORBIDDEN/],
    [`insert into public.email_contacts (organization_id, email, email_normalized, source, created_by, status, archived_at) values ('${ORG_A}', 'z@example.com', 'z@example.com', 'manual', '${A_FOUNDER}', 'archived', now())`, /EMAIL_CONTACT_INVALID_INITIAL_STATE/],
    [`insert into public.email_contacts (organization_id, email, email_normalized, source, created_by) values ('${ORG_A}', 'Mixed@Example.com', 'Mixed@Example.com', 'manual', '${A_FOUNDER}')`, /check constraint/],
  ]) {
    await assert.rejects(db.query(sql), pattern, sql);
  }
});

test("suppression lifting: authorization and liftability rules", async () => {
  // Non-privileged roles.
  for (const user of [A_LEAD, A_MEMBER]) {
    await asUser(user, () => assert.rejects(liftSuppression(state.bounce, "not allowed to lift this"), /EMAIL_ACCESS_DENIED/));
  }
  await asUser(A_FOUNDER, async () => {
    await assert.rejects(liftSuppression(state.bounce, "short"), /EMAIL_INVALID_ARGUMENT/);
    await assert.rejects(liftSuppression("00000000-0000-4000-8000-000000000000", "missing suppression id"), /EMAIL_SUPPRESSION_NOT_FOUND/);

    const complaint = await addSuppression("complainer@example.com", "complaint");
    await assert.rejects(liftSuppression(complaint.suppression_id, "customer says it was a mistake"), /EMAIL_SUPPRESSION_NOT_LIFTABLE/);
    const legal = await addSuppression("legal@example.com", "legal_request");
    await assert.rejects(liftSuppression(legal.suppression_id, "request withdrawn by customer"), /EMAIL_SUPPRESSION_NOT_LIFTABLE/);

    // Unsubscribed requires a newer consent grant that is still the latest event.
    await assert.rejects(liftSuppression(state.anaUnsub, "customer resubscribed by phone"), /EMAIL_SUPPRESSION_REQUIRES_NEW_CONSENT/);
    // A backdated re-consent cannot override the opt-out.
    await assert.rejects(grantConsent(state.anaA, { occurred_at: PAST }), /EMAIL_CONSENT_PREDATES_REVOCATION/);
    await assert.rejects(liftSuppression(state.anaUnsub, "customer resubscribed by phone"), /EMAIL_SUPPRESSION_REQUIRES_NEW_CONSENT/);
    await grantConsent(state.anaA, { method: "verbal", source: "Llamada 2026-09-26", occurred_at: new Date().toISOString() });
    const lifted = await liftSuppression(state.anaUnsub, "customer resubscribed by phone");
    assert.equal(lifted.lifted_by, A_FOUNDER);
    await assert.rejects(liftSuppression(state.anaUnsub, "customer resubscribed by phone"), /EMAIL_SUPPRESSION_ALREADY_LIFTED/);

    const manualLift = await liftSuppression(state.bounce, "mailbox confirmed working again");
    assert.ok(manualLift.lifted_at);
  });
  assert.equal((await asOwner(() => sendable(ORG_A, state.anaA))).reason_code, "SENDABLE");

  // Replaying the original revoke must not re-suppress a legitimately lifted address.
  const replay = await asUser(A_FOUNDER, () => revokeConsent(state.anaA, { reason: "Pidió no recibir más", key: "revoke-ana-0001" }));
  assert.equal(replay.was_created, false);
  assert.equal(replay.suppression_id, null);
  assert.equal((await asOwner(() => sendable(ORG_A, state.anaA))).reason_code, "SENDABLE");

  for (const [sql, pattern] of [
    [`update public.email_suppressions set lifted_at = null, lifted_by = null, lift_reason = null where id = '${state.anaUnsub}'`, /EMAIL_SUPPRESSION_ALREADY_LIFTED/],
    [`delete from public.email_suppressions where id = '${state.anaUnsub}'`, /EMAIL_SUPPRESSION_DELETE_FORBIDDEN/],
  ]) {
    await assert.rejects(db.query(sql), pattern, sql);
  }
  const active = await one("select id from public.email_suppressions where organization_id = $1 and email_normalized = 'complainer@example.com'", [ORG_A]);
  await assert.rejects(
    db.query(`update public.email_suppressions set reason = 'manual' where id = '${active.id}'`),
    /EMAIL_SUPPRESSION_IMMUTABLE/,
  );
  const liftAudit = await count("select count(*)::int from public.email_audit_log where action = 'email.suppression.lifted' and organization_id = $1", [ORG_A]);
  assert.equal(liftAudit, 2);
});

test("a new suppression can be created after a lift, and history is retained", async () => {
  const revoked = await asUser(A_FOUNDER, () => revokeConsent(state.anaA));
  assert.ok(revoked.suppression_id);
  assert.notEqual(revoked.suppression_id, state.anaUnsub);
  const history = await db.query("select lifted_at is null as active from public.email_suppressions where organization_id = $1 and email_normalized = 'ana.perez@example.com' order by created_at", [ORG_A]);
  assert.deepEqual(history.rows.map((r) => r.active), [false, true]);
  assert.equal((await asOwner(() => sendable(ORG_A, state.anaA))).reason_code, "SUPPRESSED");
});

test("API roles hold no privileges beyond the intended surface", async () => {
  const tablePrivileges = await db.query(`
    select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and table_name like 'email\\_%'
      and grantee in ('anon','authenticated','service_role')
    order by grantee, table_name, privilege_type`);
  for (const row of tablePrivileges.rows) {
    assert.equal(row.privilege_type, "SELECT", `${row.grantee} ${row.privilege_type} on ${row.table_name}`);
    assert.notEqual(row.grantee, "anon");
  }
  const executable = await db.query(`
    select p.proname, r.rolname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rolname)
    where n.nspname in ('public', 'private') and p.proname like 'email\\_%'
      and has_function_privilege(r.rolname, p.oid, 'execute')
    order by 1, 2`);
  const allowed = new Set([
    "email_add_suppression:authenticated", "email_archive_contact:authenticated",
    "email_can:authenticated", "email_create_contact:authenticated",
    "email_lift_suppression:authenticated",
    "email_record_consent:authenticated", "email_revoke_consent:authenticated",
    "email_update_contact:authenticated",
  ]);
  const actual = executable.rows.map((r) => `${r.proname}:${r.rolname}`);
  assert.deepEqual(actual.filter((entry) => !allowed.has(entry)), []);
  assert.equal(actual.length, allowed.size);
});
