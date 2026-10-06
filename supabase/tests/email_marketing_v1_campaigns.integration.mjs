// Email Marketing V1 - Increment 3c: campaign drafts, readiness, merge-value
// resolution and preview input (PGlite + the Increment 3b renderer).
//
// Run: npx -y -p @electric-sql/pglite node --test supabase/tests/email_marketing_v1_campaigns.integration.mjs

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  A_ADMIN, A_FOUNDER, A_LEAD, A_MEMBER, B_FOUNDER, EXPECTED_INC1_FP_AFTER_INC3A, INC1_NAMES, INC2_NAMES, MIGRATIONS, NO_ORG,
  ORG_A, ORG_B, STAGING_INC2_FP, createDatabase, readSql, snapshots,
} from "./email_marketing_v1_harness.mjs";
import { assembleDocument, renderTemplate } from "../functions/_shared/email/render_v1.ts";

export const INC3C_PATH = fileURLToPath(new URL("../migrations/20261005160000_email_marketing_v1_campaigns.sql", import.meta.url));
const migration3c = readSql(INC3C_PATH);
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const PREVIEW = fixture("email_campaign_preview_cases.json");
const RENDER = fixture("email_render_v1_cases.json");
const DOCUMENT = fixture("email_render_v1_document_cases.json");
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const RANDOM = "11111111-1111-4111-8111-111111111111";
const NEW_FUNCTIONS = ["email_campaigns_guard", "email_template_merge_paths", "email_resolve_merge_values", "email_preview_footer",
  "email_campaign_readiness_report", "email_create_campaign", "email_update_campaign", "email_archive_campaign",
  "email_campaign_readiness", "email_campaign_preview_input"];

async function inc3aDatabase() {
  const db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  return db;
}
async function campaignsDatabase() {
  const db = await inc3aDatabase();
  await db.exec(migration3c);
  return db;
}
async function as(db, user, callback) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    return await callback();
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}
const one = async (db, sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const auditCount = async (db) => (await one(db, "select count(*)::int as n from public.email_audit_log")).n;
const rejects = (promise, pattern, label) => assert.rejects(promise, (error) => {
  assert.match(String(error.message), pattern, label);
  return true;
});

// Everything a campaign needs, in organization A (and a twin in B).
async function seed(db, user = A_FOUNDER, suffix = "a") {
  return as(db, user, async () => {
    const domain = (await one(db, "select * from public.email_create_sender_domain($1)", [`${suffix}.example.com`])).domain_id;
    const identity = (await one(db, "select * from public.email_create_sender_identity($1, 'hola', 'Acme', null)", [domain])).identity_id;
    const template = (await one(db, "select * from public.email_create_template($1)", [`Plantilla ${suffix}`])).template_id;
    await db.query("select * from public.email_create_template_version($1, 'Hola {{contact.first_name}}', null, $2::jsonb, 0)",
      [template, JSON.stringify({ version: "email-content.v1", blocks: [{ type: "paragraph", text: "Version 1" }] })]);
    const list = (await one(db, "select * from public.email_create_list($1)", [`Lista ${suffix}`])).list_id;
    const contact = (await one(db, "select * from public.email_create_contact($1, 'Ana', 'Diaz')", [`ana@${suffix}.example.com`])).contact_id;
    const campaign = (await one(db, "select * from public.email_create_campaign($1)", [`Campana ${suffix}`])).campaign_id;
    return { domain, identity, template, list, contact, campaign };
  });
}
const listAudience = (list) => ({ version: "segment.v1", match: "all", rules: [{ type: "list", op: "in", list_id: list }] });
const update = (db, campaign, changes, expected) =>
  db.query("select * from public.email_update_campaign($1, $2::jsonb, $3)", [campaign, JSON.stringify(changes), expected]);
const readiness = async (db, campaign) => (await one(db, "select public.email_campaign_readiness($1) as r", [campaign])).r;

test("migration: additive only - Inc1/Inc2/Inc3a objects unchanged, email_can untouched, audit CHECK gains only 'campaign'", async () => {
  const db = await inc3aDatabase();
  const before = snapshots(db);
  const snap = async (s) => ({ functions: await s.functions(), policies: await s.policies(), tableAcl: await s.tableAcl(),
    constraints: await s.constraints(), triggers: await s.triggers(), indexes: await s.indexes() });
  const old = await snap(before);
  const inc1 = await before.fp(INC1_NAMES);
  await db.exec(migration3c);
  const after = snapshots(db);
  const now = await snap(after);
  const isNew = (row) => JSON.stringify(row).includes("email_campaign") || NEW_FUNCTIONS.some((name) => JSON.stringify(row).includes(name + "("));
  for (const key of Object.keys(old)) {
    const kept = now[key].filter((row) => !isNew(row) && !(row.conname === "email_audit_log_entity_type_check"));
    const was = old[key].filter((row) => !(row.conname === "email_audit_log_entity_type_check"));
    assert.deepEqual(kept, was, `${key}: every pre-existing object is byte-identical`);
  }
  assert.equal(await after.fp(INC1_NAMES), inc1, "Inc1 fingerprint unchanged");
  assert.equal(await after.fp(INC1_NAMES), EXPECTED_INC1_FP_AFTER_INC3A);
  assert.equal(await after.fp(INC2_NAMES), STAGING_INC2_FP, "Inc2 fingerprint unchanged");
  const check = (await one(db, "select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'email_audit_log_entity_type_check'")).d;
  assert.equal(check, "CHECK ((entity_type = ANY (ARRAY['contact'::text, 'consent'::text, 'suppression'::text, 'list'::text, 'tag'::text, "
    + "'custom_field'::text, 'segment'::text, 'crm_import'::text, 'sender_domain'::text, 'sender_identity'::text, 'template'::text, "
    + "'template_version'::text, 'campaign'::text])))");
  assert.deepEqual((await after.tables()).map((r) => r.relname).filter((n) => n === "email_campaigns"), ["email_campaigns"]);
  assert.equal((await after.tables()).length, 17);
  assert.equal((await all(db, `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname like 'email%'`)).length, 91);
});

test("migration safety: a drifted audit CHECK makes the migration refuse and create nothing", async () => {
  const db = await inc3aDatabase();
  await db.exec(`alter table public.email_audit_log drop constraint email_audit_log_entity_type_check,
    add constraint email_audit_log_entity_type_check check (entity_type in ('contact', 'consent', 'suppression', 'later'))`);
  await rejects(db.exec(migration3c), /EMAIL_MIGRATION_REFUSED_UNEXPECTED_STATE/);
  await db.exec("rollback").catch(() => {});
  assert.equal((await one(db, "select to_regclass('public.email_campaigns') as t")).t, null, "nothing created");
});

test("authorization: founder/admin write and read; area_lead/member/no-org/no-JWT denied; anon/service_role cannot execute; no direct DML", async () => {
  const db = await campaignsDatabase();
  const ids = await seed(db);
  await as(db, A_ADMIN, () => db.query("select * from public.email_create_campaign('Admin')"));
  for (const user of [A_LEAD, A_MEMBER, NO_ORG, ""]) {
    await as(db, user, async () => {
      await rejects(db.query("select * from public.email_create_campaign('X')"), /EMAIL_ACCESS_DENIED/, `${user} create`);
      await rejects(update(db, ids.campaign, { description: "x" }, 1), /EMAIL_ACCESS_DENIED/, `${user} update`);
      await rejects(db.query("select * from public.email_archive_campaign($1)", [ids.campaign]), /EMAIL_ACCESS_DENIED/);
      await rejects(db.query("select public.email_campaign_readiness($1)", [ids.campaign]), /EMAIL_ACCESS_DENIED/);
      await rejects(db.query("select public.email_campaign_preview_input($1, $2)", [ids.campaign, ids.contact]), /EMAIL_ACCESS_DENIED/);
      assert.equal((await all(db, "select id from public.email_campaigns")).length, 0, `${user} sees no campaign`);
    });
  }
  for (const role of ["anon", "service_role"]) {
    await db.exec(`set role ${role}`);
    for (const call of ["select * from public.email_create_campaign('X')", `select public.email_campaign_readiness('${ids.campaign}')`,
      `select public.email_campaign_preview_input('${ids.campaign}', '${ids.contact}')`, `select * from public.email_archive_campaign('${ids.campaign}')`]) {
      await rejects(db.query(call), /permission denied/, `${role}: ${call}`);
    }
    for (const fn of ["private.email_resolve_merge_values('" + ORG_A + "', '" + ids.contact + "', '" + RANDOM + "')",
      "private.email_campaign_readiness_report('" + ORG_A + "', '" + ids.campaign + "')"]) {
      await rejects(db.query(`select ${fn}`), /permission denied/, `${role}: ${fn}`);
    }
    await db.exec("reset role");
  }
  await as(db, A_FOUNDER, async () => {
    for (const dml of [`insert into public.email_campaigns (organization_id, name, created_by) values ('${ORG_A}', 'D', '${A_FOUNDER}')`,
      `update public.email_campaigns set description = 'x'`, "delete from public.email_campaigns",
      `select private.email_resolve_merge_values('${ORG_A}', '${ids.contact}', '${RANDOM}')`]) {
      await rejects(db.query(dml), /permission denied/, dml);
    }
    assert.equal((await all(db, "select id from public.email_campaigns")).length, 2, "founder reads own organization through RLS");
  });
  for (const fn of ["email_create_campaign", "email_update_campaign", "email_archive_campaign", "email_campaign_readiness", "email_campaign_preview_input"]) {
    const row = await one(db, `select p.prosecdef, array_to_string(p.proconfig, ',') as config, p.proacl::text as acl
      from pg_proc p where p.proname = $1`, [fn]);
    assert.equal(row.prosecdef, true, `${fn} is SECURITY DEFINER`);
    assert.equal(row.config, "search_path=\"\"", `${fn} pins search_path`);
    assert.ok(row.acl.includes("authenticated=X/") && !row.acl.includes("anon") && !row.acl.includes("service_role") && !/[{,]=X\//.test(row.acl), `${fn} ACL ${row.acl}`);
  }
  const acl = (await one(db, "select relacl::text as acl, relrowsecurity as rls from pg_class where relname = 'email_campaigns'"));
  assert.equal(acl.rls, true);
  assert.ok(acl.acl.includes("authenticated=r/") && acl.acl.includes("service_role=r/") && !acl.acl.includes("anon"), acl.acl);
});

test("isolation: organization B ids are indistinguishable from unknown ids; the resolver never crosses organizations", async () => {
  const db = await campaignsDatabase();
  const a = await seed(db, A_FOUNDER, "a");
  const b = await seed(db, B_FOUNDER, "b");
  const bVersion = (await one(db, "select id from public.email_template_versions where organization_id = $1", [ORG_B])).id;
  const aVersion = (await one(db, "select id from public.email_template_versions where organization_id = $1", [ORG_A])).id;
  await as(db, A_FOUNDER, async () => {
    for (const [foreign, label] of [[b.campaign, "org B campaign"], [RANDOM, "unknown campaign"]]) {
      await rejects(update(db, foreign, { description: "x" }, 1), /^EMAIL_CAMPAIGN_NOT_FOUND$/, label);
      await rejects(db.query("select * from public.email_archive_campaign($1)", [foreign]), /^EMAIL_CAMPAIGN_NOT_FOUND$/, label);
      await rejects(db.query("select public.email_campaign_readiness($1)", [foreign]), /^EMAIL_CAMPAIGN_NOT_FOUND$/, label);
      await rejects(db.query("select public.email_campaign_preview_input($1, $2)", [foreign, a.contact]), /^EMAIL_CAMPAIGN_NOT_FOUND$/, label);
    }
    for (const [foreign, label] of [[b.identity, "org B sender"], [RANDOM, "unknown sender"]]) {
      await rejects(update(db, a.campaign, { sender_identity_id: foreign }, 1), /^EMAIL_SENDER_IDENTITY_NOT_FOUND$/, label);
    }
    for (const [foreign, label] of [[b.template, "org B template"], [RANDOM, "unknown template"]]) {
      await rejects(update(db, a.campaign, { template: { template_id: foreign, version_number: 1 } }, 1), /^EMAIL_TEMPLATE_VERSION_NOT_FOUND$/, label);
    }
    for (const [foreign, label] of [[b.list, "org B list"], [RANDOM, "unknown list"]]) {
      await assert.rejects(update(db, a.campaign, { audience_definition: listAudience(foreign) }, 1), (error) => {
        assert.equal(error.message, "EMAIL_INVALID_SEGMENT", label);
        assert.equal(error.detail, "rule 1: unknown list", label);
        return true;
      });
    }
    await update(db, a.campaign, { template: { template_id: a.template, version_number: 1 } }, 1);
    for (const [foreign, label] of [[b.contact, "org B contact"], [RANDOM, "unknown contact"]]) {
      await rejects(db.query("select public.email_campaign_preview_input($1, $2)", [a.campaign, foreign]), /^EMAIL_CONTACT_NOT_FOUND$/, label);
    }
    assert.deepEqual((await all(db, "select id from public.email_campaigns")).map((r) => r.id), [a.campaign], "RLS: only organization A");
  });
  assert.equal((await one(db, "select private.email_resolve_merge_values($1, $2, $3) as v", [ORG_A, b.contact, aVersion])).v, null);
  assert.equal((await one(db, "select private.email_resolve_merge_values($1, $2, $3) as v", [ORG_A, a.contact, bVersion])).v, null);
  assert.notEqual((await one(db, "select private.email_resolve_merge_values($1, $2, $3) as v", [ORG_A, a.contact, aVersion])).v, null);
  assert.equal((await one(db, "select private.email_campaign_readiness_report($1, $2) as r", [ORG_A, b.campaign])).r, null);
});

test("lifecycle: create, duplicate create, update, no-op, stale and missing expected_version, immutable name, archive, re-archive, archived terminal", async () => {
  const db = await campaignsDatabase();
  const ids = await seed(db);
  await as(db, A_FOUNDER, async () => {
    const audit0 = await auditCount(db);
    const repeat = await one(db, "select * from public.email_create_campaign('  CAMPANA A ')");
    assert.deepEqual(repeat, { campaign_id: ids.campaign, was_created: false }, "duplicate active name returns the existing draft");
    assert.equal(await auditCount(db), audit0, "no audit for an idempotent repeat");
    await rejects(db.query("select * from public.email_create_campaign($1)", ["x\u{202E}y"]), /EMAIL_INVALID_ARGUMENT/);
    const updated = (await update(db, ids.campaign, { description: "Primera" }, 1)).rows[0];
    assert.equal(Number(updated.version), 2);
    assert.equal(await auditCount(db), audit0 + 1);
    const noop = (await update(db, ids.campaign, { description: "  Primera " }, 2)).rows[0];
    assert.equal(Number(noop.version), 2, "no-op keeps the version");
    assert.equal(noop.updated_at.getTime(), updated.updated_at.getTime());
    assert.equal(await auditCount(db), audit0 + 1, "no-op writes no audit");
    await rejects(update(db, ids.campaign, { description: "x" }, 1), /^EMAIL_CAMPAIGN_VERSION_CONFLICT$/, "stale version");
    await rejects(update(db, ids.campaign, { description: "x" }, null), /^EMAIL_INVALID_ARGUMENT$/, "null expected_version");
    await rejects(db.query("select * from public.email_update_campaign($1, '{\"description\": \"x\"}'::jsonb)", [ids.campaign]),
      /does not exist/, "no 2-argument variant: expected_version is mandatory");
    await rejects(update(db, ids.campaign, { name: "Otra" }, 2), /^EMAIL_CAMPAIGN_NAME_IMMUTABLE$/);
    for (const bad of [{}, { status: "archived" }, { audience_sha256: "0".repeat(64) }, { template: { template_id: ids.template } },
      { template: { template_id: ids.template, version_number: "1" } }, { template: { template_id: ids.template, version_number: 1.5 } },
      { sender_identity_id: "nope" }, { description: 5 }, { audience_definition: "segment" }]) {
      await rejects(update(db, ids.campaign, bad, 2), /^EMAIL_INVALID_ARGUMENT$/, JSON.stringify(bad));
    }
    assert.equal(await auditCount(db), audit0 + 1, "failures write no audit");
    const archived = (await one(db, "select * from public.email_archive_campaign($1)", [ids.campaign]));
    assert.equal(archived.status, "archived");
    assert.equal(Number(archived.version), 3);
    assert.equal(await auditCount(db), audit0 + 2);
    const again = (await one(db, "select * from public.email_archive_campaign($1)", [ids.campaign]));
    assert.deepEqual(again, archived, "re-archive returns the row unchanged");
    assert.equal(await auditCount(db), audit0 + 2, "re-archive writes no audit");
    await rejects(update(db, ids.campaign, { description: "x" }, 3), /^EMAIL_CAMPAIGN_ARCHIVED$/);
    const fresh = await one(db, "select * from public.email_create_campaign('Campana a')");
    assert.equal(fresh.was_created, true, "the name is free again once the draft is archived");
  });
  // Authoritative guard for every role (owner path).
  await rejects(db.exec(`update public.email_campaigns set name = 'Otra' where id = '${ids.campaign}'`), /EMAIL_CAMPAIGN/);
  await rejects(db.exec(`update public.email_campaigns set status = 'draft', archived_at = null, archived_by = null where id = '${ids.campaign}'`), /EMAIL_CAMPAIGN_ARCHIVED/);
  await rejects(db.exec(`delete from public.email_campaigns where id = '${ids.campaign}'`), /EMAIL_CAMPAIGN_DELETE_FORBIDDEN/);
  await rejects(db.exec("truncate public.email_campaigns"), /EMAIL_CAMPAIGN_DELETE_FORBIDDEN/);
  await rejects(db.exec(`insert into public.email_campaigns (organization_id, name, created_by, status, archived_at, archived_by)
    values ('${ORG_A}', 'Z', '${A_FOUNDER}', 'archived', now(), '${A_FOUNDER}')`), /EMAIL_CAMPAIGN_INVALID_INITIAL_STATE/);
  const live = (await one(db, "select id, version from public.email_campaigns where status = 'draft'"));
  await rejects(db.exec(`update public.email_campaigns set status = 'archived', archived_at = now(), archived_by = '${A_FOUNDER}', description = 'y'
    where id = '${live.id}'`), /EMAIL_CAMPAIGN_INVALID_TRANSITION/, "archiving cannot carry content changes");
});

test("template pinning: exact version, later versions irrelevant, archived template blocks, not-latest warns", async () => {
  const db = await campaignsDatabase();
  const ids = await seed(db);
  await as(db, A_FOUNDER, async () => {
    await rejects(update(db, ids.campaign, { template: { template_id: ids.template, version_number: 2 } }, 1), /^EMAIL_TEMPLATE_VERSION_NOT_FOUND$/);
    await update(db, ids.campaign, { template: { template_id: ids.template, version_number: 1 }, sender_identity_id: ids.identity }, 1);
    const v1 = await one(db, "select content_sha256 from public.email_template_versions where template_id = $1 and version_number = 1", [ids.template]);
    await db.query("select * from public.email_create_template_version($1, 'Version dos', null, $2::jsonb, 1)",
      [ids.template, JSON.stringify({ version: "email-content.v1", blocks: [{ type: "paragraph", text: "Version 2" }] })]);
    const campaign = await one(db, "select template_id, template_version from public.email_campaigns where id = $1", [ids.campaign]);
    assert.deepEqual(campaign, { template_id: ids.template, template_version: 1 }, "still pinned to version 1");
    const report = await readiness(db, ids.campaign);
    assert.deepEqual(report.template, { id: ids.template, version_number: 1, content_sha256: v1.content_sha256 });
    assert.ok(report.warnings.includes("TEMPLATE_VERSION_NOT_LATEST"));
    const input = (await one(db, "select public.email_campaign_preview_input($1, $2) as p", [ids.campaign, ids.contact])).p;
    assert.equal(input.template_version.subject, "Hola {{contact.first_name}}", "preview uses the pinned version, not the latest");
    assert.equal(input.template_version.content_sha256, v1.content_sha256);
    await db.query("select * from public.email_archive_template($1)", [ids.template]);
    assert.ok((await readiness(db, ids.campaign)).blocking.includes("TEMPLATE_ARCHIVED"));
    const other = (await one(db, "select * from public.email_create_campaign('Otra')")).campaign_id;
    await rejects(update(db, other, { template: { template_id: ids.template, version_number: 1 } }, 1), /^EMAIL_TEMPLATE_ARCHIVED$/);
    assert.ok((await readiness(db, other)).blocking.includes("TEMPLATE_MISSING"));
    await rejects(db.query("select public.email_campaign_preview_input($1, $2)", [other, ids.contact]), /^EMAIL_CAMPAIGN_TEMPLATE_MISSING$/);
  });
});

test("sender: same organization, archived identity refused at write and blocking in readiness, unverified domain warns", async () => {
  const db = await campaignsDatabase();
  const ids = await seed(db);
  await as(db, A_FOUNDER, async () => {
    let report = await readiness(db, ids.campaign);
    assert.ok(report.blocking.includes("SENDER_MISSING"));
    assert.equal(report.sender, null);
    await update(db, ids.campaign, { sender_identity_id: ids.identity }, 1);
    report = await readiness(db, ids.campaign);
    assert.deepEqual(report.sender, { id: ids.identity, version: 1 });
    assert.ok(report.warnings.includes("SENDER_DOMAIN_UNVERIFIED") && !report.blocking.some((c) => c.startsWith("SENDER")));
    await db.query("select * from public.email_archive_sender_identity($1)", [ids.identity]);
    assert.ok((await readiness(db, ids.campaign)).blocking.includes("SENDER_ARCHIVED"));
    const other = (await one(db, "select * from public.email_create_campaign('Otra')")).campaign_id;
    await rejects(update(db, other, { sender_identity_id: ids.identity }, 1), /^EMAIL_SENDER_IDENTITY_ARCHIVED$/);
  });
});

test("audience and readiness: inline segment.v1, live counts, empty / no-sendable / invalid, archived references, no PII, no mutation", async () => {
  const db = await campaignsDatabase();
  const ids = await seed(db);
  await as(db, A_FOUNDER, async () => {
    await db.query("select * from public.email_create_custom_field('plan', 'Plan', 'select', '[\"pro\", \"basico\"]'::jsonb)");
    const tag = (await one(db, "select * from public.email_create_tag('VIP')")).tag_id;
    let report = await readiness(db, ids.campaign);
    assert.deepEqual(report.blocking, ["AUDIENCE_MISSING", "SENDER_MISSING", "TEMPLATE_MISSING"], "sorted blocking codes");
    assert.equal(report.audience, null);
    await rejects(update(db, ids.campaign, { audience_definition: { version: "segment.v1", match: "all", rules: [] } }, 1), /EMAIL_INVALID_SEGMENT/);
    await update(db, ids.campaign, { sender_identity_id: ids.identity, template: { template_id: ids.template, version_number: 1 },
      audience_definition: listAudience(ids.list) }, 1);
    report = await readiness(db, ids.campaign);
    assert.deepEqual(report.blocking, ["AUDIENCE_EMPTY"]);
    assert.deepEqual(report.audience, { matched: 0, sendable: 0, not_sendable_by_reason: {} });
    await db.query("select public.email_add_list_members($1, $2::uuid[])", [ids.list, [ids.contact]]);
    report = await readiness(db, ids.campaign);
    assert.deepEqual(report.blocking, ["AUDIENCE_NO_SENDABLE"]);
    assert.deepEqual(report.audience, { matched: 1, sendable: 0, not_sendable_by_reason: { CONSENT_MISSING: 1 } });
    await db.query("select * from public.email_record_consent($1, 'written', 'Form', 'Acepto', 'v1', '2026-09-01T10:00:00Z')", [ids.contact]);
    report = await readiness(db, ids.campaign);
    assert.equal(report.ready, true);
    assert.deepEqual(report.blocking, []);
    assert.deepEqual(report.warnings, ["SENDER_DOMAIN_UNVERIFIED"]);
    assert.deepEqual(Object.keys(report).sort(), ["audience", "audience_sha256", "blocking", "campaign_version", "ready", "sender", "template", "warnings"]);
    assert.ok(!JSON.stringify(report).includes("example.com") && !JSON.stringify(report).includes("Ana"), "no contact PII or samples");
    await db.query("select public.email_remove_list_members($1, $2::uuid[])", [ids.list, [ids.contact]]);
    assert.deepEqual((await readiness(db, ids.campaign)).blocking, ["AUDIENCE_EMPTY"], "live membership is reflected");
    // Archived list / tag references stay valid segment.v1 but warn.
    const v = (await one(db, "select version from public.email_campaigns where id = $1", [ids.campaign])).version;
    await update(db, ids.campaign, { audience_definition: { version: "segment.v1", match: "any", rules: [
      { type: "list", op: "in", list_id: ids.list }, { type: "tag", op: "has", tag_id: tag }] } }, v);
    await db.query("select * from public.email_archive_list($1)", [ids.list]);
    await db.query("select * from public.email_archive_tag($1)", [tag]);
    report = await readiness(db, ids.campaign);
    assert.deepEqual(report.warnings, ["AUDIENCE_REFERENCES_ARCHIVED_LIST", "AUDIENCE_REFERENCES_ARCHIVED_TAG", "SENDER_DOMAIN_UNVERIFIED"]);
    // Inc2 segment.v1 semantics (unchanged): a referenced custom field that is
    // archived later still exists, so the stored definition stays valid.
    const v2 = (await one(db, "select version from public.email_campaigns where id = $1", [ids.campaign])).version;
    await update(db, ids.campaign, { audience_definition: { version: "segment.v1", match: "all", rules: [
      { type: "custom_field", key: "plan", op: "eq", value: "pro" }] } }, v2);
    const field = (await one(db, "select id from public.email_custom_field_definitions where key = 'plan'")).id;
    await db.query("select * from public.email_archive_custom_field($1)", [field]);
    report = await readiness(db, ids.campaign);
    assert.ok(!report.blocking.includes("AUDIENCE_INVALID") && report.audience !== null, JSON.stringify(report));
    // Readiness is read-only: no row, version or audit changes; STABLE.
    const state = async () => JSON.stringify([await all(db, "select * from public.email_campaigns order by id"), await auditCount(db)]);
    const before = await state();
    await readiness(db, ids.campaign);
    await readiness(db, ids.campaign);
    assert.equal(await state(), before, "readiness changes nothing");
    await db.query("select * from public.email_archive_campaign($1)", [ids.campaign]);
    assert.ok((await readiness(db, ids.campaign)).blocking.includes("CAMPAIGN_ARCHIVED"));
  });
  // AUDIENCE_INVALID: a stored definition that no longer validates. Only an
  // owner path with the guard disabled (test-only) can create one; readiness
  // re-validates live and refuses without evaluating counts.
  await db.exec("alter table public.email_campaigns disable trigger email_campaigns_guard");
  await db.exec(`insert into public.email_campaigns (organization_id, name, created_by, audience_definition, audience_sha256)
    values ('${ORG_A}', 'Invalida', '${A_FOUNDER}', '{"version":"segment.v1","match":"all","rules":[{"type":"list","op":"in","list_id":"${RANDOM}"}]}', '${"0".repeat(64)}')`);
  await db.exec("alter table public.email_campaigns enable trigger email_campaigns_guard");
  const invalid = (await one(db, "select id from public.email_campaigns where name = 'Invalida'")).id;
  await as(db, A_FOUNDER, async () => {
    const report = await readiness(db, invalid);
    assert.ok(report.blocking.includes("AUDIENCE_INVALID") && report.audience === null, JSON.stringify(report));
  });
  for (const fn of ["email_campaign_readiness", "email_campaign_readiness_report", "email_campaign_preview_input",
    "email_resolve_merge_values", "email_template_merge_paths"]) {
    const volatility = (await one(db, "select provolatile from pg_proc where proname = $1", [fn])).provolatile;
    assert.ok(volatility === "s" || volatility === "i", `${fn} is not volatile`);
  }
});

test("readiness uuid semantics (M1): archived list/tag warnings hold for lowercase and uppercase UUIDs; live ids, malformed and cross-org ids never warn", async () => {
  const db = await campaignsDatabase();
  const a = await seed(db, A_FOUNDER, "a");
  const b = await seed(db, B_FOUNDER, "b");
  const { tag, campaigns } = await as(db, A_FOUNDER, async () => {
    const tagId = (await one(db, "select * from public.email_create_tag('VIP')")).tag_id;
    const ids = {};
    for (const [label, rule] of [
      ["list lower", { type: "list", op: "in", list_id: a.list.toLowerCase() }],
      ["list UPPER", { type: "list", op: "in", list_id: a.list.toUpperCase() }],
      ["tag lower", { type: "tag", op: "has", tag_id: tagId.toLowerCase() }],
      ["tag UPPER", { type: "tag", op: "has", tag_id: tagId.toUpperCase() }],
    ]) {
      const campaign = (await one(db, "select * from public.email_create_campaign($1)", [label])).campaign_id;
      await update(db, campaign, { sender_identity_id: a.identity, template: { template_id: a.template, version_number: 1 },
        audience_definition: { version: "segment.v1", match: "all", rules: [rule] } }, 1);
      ids[label] = campaign;
    }
    const mixed = (await one(db, "select * from public.email_create_campaign('mixed')")).campaign_id;
    await update(db, mixed, { audience_definition: { version: "segment.v1", match: "any", rules: [
      { type: "tag", op: "has", tag_id: tagId.toUpperCase() }, { type: "list", op: "in", list_id: a.list.toUpperCase() }] } }, 1);
    ids.mixed = mixed;
    // Live (not archived) references never warn, in either case.
    for (const label of ["list lower", "list UPPER", "tag lower", "tag UPPER", "mixed"]) {
      const report = await readiness(db, ids[label]);
      assert.ok(!report.warnings.some((w) => w.startsWith("AUDIENCE_REFERENCES")), `${label}: live ids do not warn`);
    }
    // Malformed UUID text is refused at write time exactly like any invalid reference (Inc2 validation).
    await rejects(update(db, mixed, { audience_definition: { version: "segment.v1", match: "all", rules: [
      { type: "list", op: "in", list_id: "not-a-uuid" }] } }, 2), /^EMAIL_INVALID_SEGMENT$/, "malformed list_id");
    return { tag: tagId, campaigns: ids };
  });
  // An organization-B id, in either case, behaves exactly like an unknown id.
  await as(db, A_FOUNDER, async () => {
    for (const foreign of [b.list.toUpperCase(), b.list.toLowerCase(), RANDOM.toUpperCase()]) {
      await assert.rejects(update(db, campaigns.mixed, { audience_definition: { version: "segment.v1", match: "all", rules: [
        { type: "list", op: "in", list_id: foreign }] } }, 2), (error) => {
        assert.equal(error.message, "EMAIL_INVALID_SEGMENT");
        assert.equal(error.detail, "rule 1: unknown list", foreign);
        return true;
      });
    }
    await db.query("select * from public.email_archive_list($1)", [a.list]);
    await db.query("select * from public.email_archive_tag($1)", [tag]);
    const expected = {
      "list lower": ["AUDIENCE_REFERENCES_ARCHIVED_LIST", "SENDER_DOMAIN_UNVERIFIED"],
      "list UPPER": ["AUDIENCE_REFERENCES_ARCHIVED_LIST", "SENDER_DOMAIN_UNVERIFIED"],
      "tag lower": ["AUDIENCE_REFERENCES_ARCHIVED_TAG", "SENDER_DOMAIN_UNVERIFIED"],
      "tag UPPER": ["AUDIENCE_REFERENCES_ARCHIVED_TAG", "SENDER_DOMAIN_UNVERIFIED"],
      mixed: ["AUDIENCE_REFERENCES_ARCHIVED_LIST", "AUDIENCE_REFERENCES_ARCHIVED_TAG"],
    };
    const state = async () => JSON.stringify([await all(db, "select * from public.email_campaigns order by id"), await auditCount(db)]);
    const before = await state();
    for (const [label, warnings] of Object.entries(expected)) {
      const first = await readiness(db, campaigns[label]);
      const second = await readiness(db, campaigns[label]);
      assert.deepEqual(first.warnings, warnings, `${label}: warnings (sorted, C order)`);
      assert.deepEqual(second, first, `${label}: deterministic`);
      assert.ok(!JSON.stringify(first).includes("example.com") && !("sample" in (first.audience ?? {})), `${label}: no PII, no sample`);
    }
    assert.equal(await state(), before, "readiness wrote nothing (no row, version or audit change)");
  });
  // Owner path only (guard disabled, test-only): definitions the API can never store.
  // A malformed list_id or tag_id must not crash readiness (no 22P02 cast
  // error) and must not warn; an organization-B archived list is invisible to
  // organization A's readiness. The tag cases cover the tag CASE guard on its
  // own (malformed text, a non-string value, and the id of an ARCHIVED tag in
  // a form Inc2 rejects).
  await db.exec("alter table public.email_campaigns disable trigger email_campaigns_guard");
  await as(db, B_FOUNDER, () => db.query("select * from public.email_archive_list($1)", [b.list]));
  const ownerCases = [
    ["owner malformed list", { type: "list", op: "in", list_id: "not-a-uuid" }],
    ["owner org B archived list", { type: "list", op: "in", list_id: b.list.toUpperCase() }],
    ["owner malformed tag", { type: "tag", op: "has", tag_id: "not-a-uuid" }],
    ["owner malformed tag (number)", { type: "tag", op: "has", tag_id: 456 }],
    ["owner malformed tag (archived id + space)", { type: "tag", op: "has", tag_id: `${tag} ` }],
  ];
  for (const [name, rule] of ownerCases) {
    await db.query(`insert into public.email_campaigns (organization_id, name, created_by, audience_definition, audience_sha256)
      values ($1, $2, $3, $4::jsonb, $5)`, [ORG_A, name, A_FOUNDER,
      JSON.stringify({ version: "segment.v1", match: "all", rules: [rule] }), "0".repeat(64)]);
  }
  await db.exec("alter table public.email_campaigns enable trigger email_campaigns_guard");
  await as(db, A_FOUNDER, async () => {
    const state = async () => JSON.stringify([await all(db, "select * from public.email_campaigns order by id"), await auditCount(db)]);
    const before = await state();
    for (const [name] of ownerCases) {
      const id = (await one(db, "select id from public.email_campaigns where name = $1", [name])).id;
      let report;
      await assert.doesNotReject(async () => { report = await readiness(db, id); }, `${name}: readiness never raises (no 22P02)`);
      assert.ok(report.blocking.includes("AUDIENCE_INVALID") && report.audience === null, `${name}: ${JSON.stringify(report)}`);
      assert.ok(!report.warnings.includes("AUDIENCE_REFERENCES_ARCHIVED_LIST")
        && !report.warnings.includes("AUDIENCE_REFERENCES_ARCHIVED_TAG"), `${name}: no archived-reference warning`);
      assert.deepEqual(await readiness(db, id), report, `${name}: deterministic`);
      assert.ok(!JSON.stringify(report).includes("example.com"), `${name}: no PII`);
    }
    assert.equal(await state(), before, "owner-path readiness wrote nothing (no row, version or audit change)");
  });
});

test("audience_sha256: PostgreSQL canonical jsonb text, independent of key order and whitespace; caller can never supply it", async () => {
  const db = await campaignsDatabase();
  const ids = await seed(db);
  // Hand-written PostgreSQL canonical text (keys by length, then bytewise; ", " and ": ").
  const canonical = `{"match": "all", "rules": [{"op": "in", "type": "list", "list_id": "${ids.list}"}], "version": "segment.v1"}`;
  const variants = [
    `{"version":"segment.v1","match":"all","rules":[{"type":"list","op":"in","list_id":"${ids.list}"}]}`,
    `{ "rules" : [ { "list_id" : "${ids.list}" , "op" : "in" , "type" : "list" } ] ,\n "match" : "all" , "version" : "segment.v1" }`,
    `{"match":"any","match":"all","version":"segment.v1","rules":[{"op":"in","type":"list","list_id":"${ids.list}"}]}`,
  ];
  await as(db, A_FOUNDER, async () => {
    let version = 1;
    for (const text of variants) {
      const row = (await db.query("select * from public.email_update_campaign($1, jsonb_build_object('audience_definition', $2::jsonb), $3)",
        [ids.campaign, text, version])).rows[0];
      version = Number(row.version);
      assert.equal(row.audience_sha256, sha256(canonical), text);
      assert.equal((await one(db, "select audience_definition::text as t from public.email_campaigns where id = $1", [ids.campaign])).t, canonical);
    }
    assert.equal(version, 2, "equivalent definitions after the first are no-ops (no version bump)");
    await db.query("select * from public.email_create_custom_field('score', 'Score', 'number')");
    const numeric = (value) => `{"match": "all", "rules": [{"op": "gt", "key": "score", "type": "custom_field", "value": ${value}}], "version": "segment.v1"}`;
    const hashes = [];
    for (const [input, stored] of [["1.50", "1.50"], ["1.5", "1.5"], ["1e2", "100"]]) {
      const row = (await db.query("select * from public.email_update_campaign($1, jsonb_build_object('audience_definition', $2::jsonb), $3)",
        [ids.campaign, `{"version":"segment.v1","match":"all","rules":[{"type":"custom_field","key":"score","op":"gt","value":${input}}]}`, version])).rows[0];
      version = Number(row.version);
      assert.equal(row.audience_sha256, sha256(numeric(stored)), `numeric form ${input} -> ${stored}`);
      hashes.push(row.audience_sha256);
    }
    assert.equal(new Set(hashes).size, 3, "numeric text forms are significant (same rule as content_sha256)");
    const cleared = (await update(db, ids.campaign, { audience_definition: null }, version)).rows[0];
    assert.equal(cleared.audience_sha256, null);
  });
  await db.exec(`insert into public.email_campaigns (organization_id, name, created_by, audience_definition, audience_sha256)
    values ('${ORG_A}', 'Owner', '${A_FOUNDER}', '{"version":"segment.v1","match":"all","rules":[{"type":"list","op":"in","list_id":"${ids.list}"}]}', '${"0".repeat(64)}')`);
  assert.equal((await one(db, "select audience_sha256 from public.email_campaigns where name = 'Owner'")).audience_sha256, sha256(canonical),
    "a supplied hash is always replaced by the server-computed one");
});

test("merge values: extractor parity with the validating parser; typed values, absent vs pass-through, archived_custom, only referenced paths", async () => {
  const db = await campaignsDatabase();
  await as(db, A_FOUNDER, async () => {
    for (const [key, type, options] of [["plan", "select", ["pro", "basico"]], ["score", "number", null], ["limit", "number", null],
      ["vip", "boolean", null], ["birthday", "date", null], ["note", "text", null]]) {
      await db.query("select * from public.email_create_custom_field($1, $2, $3, coalesce($4::jsonb, '[]'::jsonb))", [key, key, type, options && JSON.stringify(options)]);
    }
  });
  // Parity: for every stored-valid template of the committed vectors, the non-validating extractor
  // returns exactly the paths the validating parser returns (all fields active).
  let compared = 0;
  for (const vector of [...RENDER.cases, ...DOCUMENT.cases, ...PREVIEW.cases]) {
    const t = vector.template;
    const texts = [["subject", t.subject], ["preheader", t.preheader],
      ...t.content.blocks.map((b, i) => [`block ${i + 1}`, ["heading", "paragraph", "button"].includes(b.type) ? b.text : null])];
    const validating = new Set();
    for (const [location, text] of texts) {
      if (text === null || text === undefined) continue;
      for (const path of (await one(db, "select private.email_merge_tag_paths($1, $2, $3) as p", [ORG_A, location, text])).p) validating.add(path);
    }
    const extracted = (await one(db, "select private.email_template_merge_paths($1, $2, $3::jsonb) as p", [t.subject, t.preheader, JSON.stringify(t.content)])).p;
    assert.deepEqual(extracted, [...validating].sort(), vector.name);
    compared += 1;
  }
  assert.ok(compared >= 60, `parity over ${compared} templates`);
  const paths = (await one(db, "select private.email_template_merge_paths($1, $2, $3::jsonb) as p",
    ["{{ custom.zeta | a }} {{contact.email}}", "{{custom.plan|b}}", JSON.stringify({ version: "email-content.v1", blocks: [
      { type: "image", src: "https://a.example.com/i.png", alt: "x" }, { type: "button", text: "{{custom.alpha}}", url: "https://a.example.com" }] })])).p;
  assert.deepEqual(paths, ["contact.email", "custom.alpha", "custom.plan", "custom.zeta"], "bytewise order; unknown/archived keys still reported; no raise");
});

test("preview input + Increment 3b renderer: hand-written vectors, pinned version, fixed footer, deterministic, read-only", async () => {
  for (const vector of PREVIEW.cases) {
    const db = await campaignsDatabase();
    const ids = await seed(db);
    const input = await as(db, A_FOUNDER, async () => {
      for (const [key, type, options] of [["plan", "select", ["pro", "basico"]], ["score", "number", null], ["vip", "boolean", null],
        ["birthday", "date", null], ["note", "text", null]]) {
        await db.query("select * from public.email_create_custom_field($1, $2, $3, coalesce($4::jsonb, '[]'::jsonb))", [key, key, type, options && JSON.stringify(options)]);
      }
      const c = vector.contact;
      const contact = (await one(db, "select * from public.email_create_contact($1, $2, $3)", [c.email, c.first_name, c.last_name])).contact_id;
      if (vector.custom_values_json !== null) await db.query("select public.email_set_contact_fields($1, $2::jsonb)", [contact, vector.custom_values_json]);
      if (vector.consent) await db.query("select * from public.email_record_consent($1, 'written', 'Form', 'Acepto', 'v1', '2026-09-01T10:00:00Z')", [contact]);
      const template = (await one(db, "select * from public.email_create_template('Vista')")).template_id;
      await db.query("select * from public.email_create_template_version($1, $2, $3, $4::jsonb, 0)",
        [template, vector.template.subject, vector.template.preheader, JSON.stringify(vector.template.content)]);
      await update(db, ids.campaign, { sender_identity_id: ids.identity, template: { template_id: template, version_number: 1 } }, 1);
      for (const key of vector.archive_fields) {
        const field = (await one(db, "select id from public.email_custom_field_definitions where key = $1", [key])).id;
        await db.query("select * from public.email_archive_custom_field($1)", [field]);
      }
      const state = async () => JSON.stringify([await all(db, "select * from public.email_campaigns order by id"), await auditCount(db)]);
      const before = await state();
      const first = (await one(db, "select public.email_campaign_preview_input($1, $2) as p", [ids.campaign, contact])).p;
      const second = (await one(db, "select public.email_campaign_preview_input($1, $2) as p", [ids.campaign, contact])).p;
      assert.deepEqual(second, first, `${vector.name}: deterministic`);
      assert.equal(await state(), before, `${vector.name}: preview changes nothing`);
      return first;
    });
    assert.deepEqual(Object.keys(input).sort(), ["campaign_version", "contact", "footer", "template_version", "values"], vector.name);
    assert.deepEqual(input.values, vector.expected_values, `${vector.name}: resolved values`);
    assert.deepEqual(input.contact, vector.expected_contact, `${vector.name}: sendability`);
    assert.deepEqual(input.footer, { version: "email-footer.v1", organization_name: "ORVESEN - vista previa",
      unsubscribe_label: "Darse de baja (vista previa)", unsubscribe_url: "https://unsubscribe.preview.invalid/orvesen-preview",
      notice: "Vista previa: este enlace de baja no funciona y no cambia ninguna suscripcion." }, `${vector.name}: fixed preview footer`);
    const rendered = renderTemplate(input.template_version, input.values);
    if (vector.expected.error !== undefined) {
      assert.deepEqual(rendered, { ok: false, ...vector.expected }, `${vector.name}: render failure`);
      continue;
    }
    const doc = assembleDocument(rendered, input.footer);
    assert.equal(doc.ok, true, `${vector.name}: ${JSON.stringify(doc)}`);
    assert.equal(doc.html, vector.expected.html, `${vector.name}: html`);
    assert.equal(doc.text, vector.expected.text, `${vector.name}: text`);
  }
});

test("audit: one row per real mutation with identifiers/hashes only; nothing for no-ops, failures, readiness or preview", async () => {
  const db = await campaignsDatabase();
  const ids = await seed(db);
  await as(db, A_FOUNDER, async () => {
    await db.query("select public.email_add_list_members($1, $2::uuid[])", [ids.list, [ids.contact]]);
    await update(db, ids.campaign, { description: "Secreto interno", sender_identity_id: ids.identity,
      template: { template_id: ids.template, version_number: 1 }, audience_definition: listAudience(ids.list) }, 1);
    await update(db, ids.campaign, { description: "Secreto interno" }, 2);
    await rejects(update(db, ids.campaign, { description: "x" }, 1), /CONFLICT/);
    await readiness(db, ids.campaign);
    await db.query("select public.email_campaign_preview_input($1, $2)", [ids.campaign, ids.contact]);
    await db.query("select * from public.email_archive_campaign($1)", [ids.campaign]);
    await db.query("select * from public.email_archive_campaign($1)", [ids.campaign]);
  });
  const rows = await all(db, "select action, entity_id, details from public.email_audit_log where entity_type = 'campaign' order by id");
  assert.deepEqual(rows.map((r) => r.action), ["email.campaign.created", "email.campaign.updated", "email.campaign.archived"]);
  assert.ok(rows.every((r) => r.entity_id === ids.campaign));
  const campaign = await one(db, "select audience_sha256 from public.email_campaigns where id = $1", [ids.campaign]);
  assert.deepEqual(rows[1].details, { changed_fields: ["description", "sender_identity_id", "template", "audience_definition"], version: 2,
    sender_identity_id: ids.identity, template_id: ids.template, template_version: 1, audience_sha256: campaign.audience_sha256 });
  const text = JSON.stringify(rows);
  for (const leak of ["Secreto", "example.com", "Ana", ids.list, "segment.v1", "Version 1", "Hola"]) assert.ok(!text.includes(leak), `audit has no ${leak}`);
});
