// Static contracts for Email Marketing V1 - Increment 3c (campaign drafts).
// Run: node --test supabase/tests/validate_email_marketing_v1_campaigns.mjs

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  INC1, INC2, INC3A, STAGING_HISTORY, emailOrderViolation, readText, stagingHistoryViolation,
} from "./email_marketing_v1_migration_order.mjs";

const INC3C = "20261003120000_email_marketing_v1_campaigns.sql";
const CHAIN = [INC1, INC2, INC3A, INC3C];
const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const sql = readText(path(`../migrations/${INC3C}`));
const code = sql.replace(/--[^\n]*/g, "");
const lower = code.toLowerCase();
const RPCS = ["email_create_campaign(text, text)", "email_update_campaign(uuid, jsonb, bigint)", "email_archive_campaign(uuid)",
  "email_campaign_readiness(uuid)", "email_campaign_preview_input(uuid, uuid)"];
const PRIVATE = ["email_campaigns_guard()", "email_template_merge_paths(text, text, jsonb)", "email_resolve_merge_values(uuid, uuid, uuid)",
  "email_preview_footer()", "email_campaign_readiness_report(uuid, uuid)"];

function functionBodies() {
  const bodies = {};
  for (const match of code.matchAll(/create or replace function (public|private)\.([a-z_]+)\(([\s\S]*?)\$\$;/g)) bodies[`${match[1]}.${match[2]}`] = match[0];
  return bodies;
}

test("ordering: Increment 3c is the fourth Email migration and sorts after every recorded and pending one", () => {
  const files = readdirSync(path("../migrations"));
  assert.equal(emailOrderViolation(files, CHAIN, STAGING_HISTORY.rows, CHAIN), null);
  assert.equal(stagingHistoryViolation(STAGING_HISTORY.rows, CHAIN), null);
  assert.ok(files.filter((f) => f.endsWith(".sql")).every((f) => f === INC3C || f.split("_")[0] < "20261003120000"),
    "no migration in this tree sorts after Increment 3c");
});

test("form: ASCII only, no CASCADE, no DROP of existing objects except the audit CHECK swap, email_can untouched", () => {
  assert.ok([...Buffer.from(sql, "utf8")].every((byte) => byte < 128), "ASCII only (SQL Editor paste safety)");
  assert.ok(!/\bcascade\b/.test(lower));
  const drops = [...lower.matchAll(/\bdrop\s+(\w+)\s+([a-z_.]+)/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(drops, ["constraint email_audit_log_entity_type_check"], "the only DROP is the CHECK being replaced");
  assert.ok(!/function\s+private\.email_can\b/.test(lower) && !/function\s+private\.email_require\b/.test(lower), "authorization helpers are not redefined");
  const created = [...lower.matchAll(/create or replace function (public|private)\.([a-z_]+)\(/g)].map((m) => `${m[1]}.${m[2]}`).sort();
  assert.deepEqual(created, [...RPCS.map((s) => "public." + s.split("(")[0]), ...PRIVATE.map((s) => "private." + s.split("(")[0])].sort(),
    "exactly the Increment 3c functions are created");
  assert.deepEqual([...lower.matchAll(/create table ([a-z_.]+)/g)].map((m) => m[1]), ["public.email_campaigns"]);
  assert.ok(lower.indexOf("email_migration_refused_unexpected_state") < lower.indexOf("drop constraint email_audit_log_entity_type_check"),
    "the drift check runs before the CHECK is replaced");
});

test("security: SECURITY DEFINER only on the five RPCs, every function pins search_path, grants are exact", () => {
  const bodies = functionBodies();
  assert.equal(Object.keys(bodies).length, 10);
  for (const [name, body] of Object.entries(bodies)) {
    assert.ok(/set search_path = ''/.test(body), `${name} pins search_path`);
    const definer = /\bsecurity definer\b/.test(body);
    assert.equal(definer, name.startsWith("public."), `${name}: SECURITY DEFINER only on public RPCs`);
  }
  for (const signature of [...RPCS.map((s) => "public." + s), ...PRIVATE.map((s) => "private." + s)]) {
    assert.ok(lower.includes(`alter function ${signature} owner to postgres;`), `${signature} owner`);
    assert.ok(lower.includes(`revoke all on function ${signature} from public, anon, authenticated, service_role;`), `${signature} revoked`);
  }
  const grants = [...lower.matchAll(/grant execute on function ([^;]+) to ([a-z_, ]+);/g)].map((m) => `${m[1]} -> ${m[2]}`).sort();
  assert.deepEqual(grants, RPCS.map((s) => `public.${s} -> authenticated`).sort(), "only the RPCs, only to authenticated");
  assert.ok(lower.includes("revoke all on table public.email_campaigns from public, anon, authenticated, service_role;"));
  assert.ok(lower.includes("grant select on table public.email_campaigns to authenticated, service_role;"));
  assert.equal([...lower.matchAll(/grant (insert|update|delete|truncate|all)/g)].length, 0, "no write grant to anyone");
  assert.ok(lower.includes("alter table public.email_campaigns enable row level security;"));
  assert.equal([...lower.matchAll(/create policy (\w+) on public\.email_campaigns\s+for (\w+)/g)].map((m) => m[2]).join(","), "select");
});

test("authorization: organization derived server-side; writes need manage_campaigns, reads need read; no organization parameter", () => {
  const bodies = functionBodies();
  for (const name of ["public.email_create_campaign", "public.email_update_campaign", "public.email_archive_campaign"]) {
    assert.ok(bodies[name].includes("organization uuid := private.email_require('manage_campaigns');"), name);
  }
  for (const name of ["public.email_campaign_readiness", "public.email_campaign_preview_input"]) {
    assert.ok(bodies[name].includes("organization uuid := private.email_require('read');"), name);
  }
  for (const name of Object.keys(bodies).filter((n) => n.startsWith("public."))) {
    const parameters = bodies[name].slice(bodies[name].indexOf("(") + 1, bodies[name].indexOf("\nreturns"));
    assert.ok(parameters.length > 0 && !/organization/i.test(parameters), `${name} accepts no organization: ${parameters.trim()}`);
  }
  assert.ok(!/is_platform_owner/.test(lower), "no platform bypass");
});

test("expected_version is mandatory; name is immutable; the caller can never supply audience_sha256 or the status", () => {
  const update = functionBodies()["public.email_update_campaign"];
  assert.ok(/p_expected_version bigint\n\)/.test(update), "no default for p_expected_version");
  assert.ok(update.includes("if p_expected_version is null"), "null is rejected");
  assert.ok(update.includes("where change.key not in ('description', 'sender_identity_id', 'template', 'audience_definition')"),
    "patchable keys are exactly these");
  assert.ok(update.includes("EMAIL_CAMPAIGN_NAME_IMMUTABLE"));
  const guard = functionBodies()["private.email_campaigns_guard"];
  assert.ok(guard.includes("new.audience_sha256 := case when new.audience_definition is null then null")
    && guard.includes("encode(sha256(convert_to(new.audience_definition::text, 'UTF8')), 'hex')"), "hash always recomputed from canonical text");
});

test("no SQL renderer: the migration never escapes, assembles or emits HTML", () => {
  for (const marker of ["&amp;", "&lt;", "&gt;", "&quot;", "&#39;", "<br>", "<p>", "<html", "<!doctype", "escape"]) {
    assert.ok(!lower.includes(marker), `no ${marker} in executable SQL`);
  }
  const preview = functionBodies()["public.email_campaign_preview_input"];
  assert.ok(preview.includes("'template_version', jsonb_build_object(") && preview.includes("'values', merge_values"),
    "preview returns render INPUT (pinned version + values), not output");
  const footer = functionBodies()["private.email_preview_footer"];
  assert.ok(footer.includes("'version', 'email-footer.v1'") && footer.includes("https://unsubscribe.preview.invalid/"),
    "fixed preview footer under the reserved .invalid TLD");
});

test("audit: campaign events carry identifiers and hashes only", () => {
  const writes = [...code.matchAll(/perform private\.email_write_audit\(organization, '(email\.campaign\.[a-z]+)'[\s\S]*?\);\n/g)];
  assert.deepEqual(writes.map((m) => m[1]).sort(), ["email.campaign.archived", "email.campaign.created", "email.campaign.updated"]);
  for (const [text] of writes) {
    for (const forbidden of ["audience_definition)", "next_audience", "description", "content", "email)", "subject"]) {
      assert.ok(!text.includes(forbidden), `audit call never carries ${forbidden}`);
    }
  }
  assert.ok(lower.includes("'campaign'\n  ));"), "audit CHECK gains exactly 'campaign'");
});
