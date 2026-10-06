// Static contract validation for Email Marketing V1 - Increment 3a
// (senders, templates, email-content.v1 validation).
// Run: node --test supabase/tests/validate_email_marketing_v1_senders_templates.mjs
//
// EMAIL_INC3A_MIGRATION_PATH exists only for the mutation runner; normal runs
// never set it.

import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMAIL_CHAIN, INC1, INC2, INC3A, STAGING_HISTORY, STAGING_HISTORY_AT_INC3A, emailOrderViolation, fileOf,
  isEmailMarketingFile, isEmailMarketingName, readText, stagingHistoryViolation,
} from "./email_marketing_v1_migration_order.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "../migrations");
const inc1Raw = readFileSync(resolve(migrationsDir, INC1));
const inc2Raw = readFileSync(resolve(migrationsDir, INC2));
const rawBuffer = Buffer.from(readText(process.env.EMAIL_INC3A_MIGRATION_PATH || resolve(migrationsDir, INC3A)), "utf8");
const raw = rawBuffer.toString("utf8");
const code = raw.toLowerCase().replace(/--[^\n]*/g, "");
const inc1Code = readText(resolve(migrationsDir, INC1)).toLowerCase().replace(/--[^\n]*/g, "");
const inc2Code = readText(resolve(migrationsDir, INC2)).toLowerCase().replace(/--[^\n]*/g, "");

const TABLES = ["email_sender_domains", "email_sender_identities", "email_templates", "email_template_versions"];
const SENDER_RPCS = ["email_create_sender_domain", "email_archive_sender_domain", "email_create_sender_identity",
  "email_update_sender_identity", "email_archive_sender_identity"];
const CONTENT_RPCS = ["email_create_template", "email_archive_template", "email_create_template_version"];
const READ_RPCS = ["email_validate_content"];
const RPCS = [...SENDER_RPCS, ...CONTENT_RPCS, ...READ_RPCS];

function functionBlocks(source) {
  const pattern = /create or replace function ([a-z_]+\.[a-z_]+)\(([\s\S]*?)\)\s*returns([\s\S]*?)\nas \$\$([\s\S]*?)\$\$;/g;
  return [...source.matchAll(pattern)].map((m) => ({ name: m[1], args: m[2], header: m[3], body: m[4] }));
}
const blocks = functionBlocks(code);
const md5 = (buffer) => createHash("md5").update(buffer).digest("hex");
const stripCr = (buffer) => Buffer.from(buffer.toString("utf8").replace(/\r/g, ""), "utf8");

test("Increments 1 and 2 are byte-identical to the versions validated on Staging", () => {
  assert.equal(md5(stripCr(inc1Raw)), "dbc4208d3b3df5f35248042a7cfe1113");
  assert.equal(md5(stripCr(inc2Raw)), "7e8ec38ab2a5f7bd650bafc740d62525");
});

test("file hygiene: ASCII only", () => {
  assert.ok([...rawBuffer].every((byte) => byte < 128), "migration must be ASCII-only (SQL Editor paste safety)");
});

test("ordering (current invariants): this worktree and the current Staging history satisfy the rules", () => {
  // Holds for any refresh of the Staging history fixture (no row counts, no
  // assumption about which increments are applied yet).
  const files = readdirSync(migrationsDir);
  assert.deepEqual(EMAIL_CHAIN, [INC1, INC2, INC3A]);
  for (const prefix of [[INC1], [INC1, INC2], [INC1, INC2, INC3A]]) {
    assert.equal(emailOrderViolation(files, prefix), null, prefix.join(" -> "));
  }
  assert.equal(stagingHistoryViolation(STAGING_HISTORY.rows), null);
  assert.ok(STAGING_HISTORY.rows.some((r) => fileOf(r) === INC1) && STAGING_HISTORY.rows.some((r) => fileOf(r) === INC2),
    "Inc1 and Inc2 are applied on Staging");
});

test("ordering (historical snapshot 2026-09-29, immutable): the history Increment 3a was built against", () => {
  assert.equal(STAGING_HISTORY_AT_INC3A.captured_on, "2026-09-29");
  assert.equal(STAGING_HISTORY_AT_INC3A.rows.length, 77);
  assert.deepEqual(STAGING_HISTORY_AT_INC3A.rows.slice(-2).map(fileOf), [INC1, INC2], "Inc1 then Inc2, the latest rows");
  assert.ok(!STAGING_HISTORY_AT_INC3A.rows.some((r) => fileOf(r) === INC3A), "Inc3a was not applied when it was built");
  assert.equal(stagingHistoryViolation(STAGING_HISTORY_AT_INC3A.rows), null);
});

test("ordering: one Email Marketing predicate for files and history rows", () => {
  for (const [file, expected] of [[INC1, true], ["20261002000000_email_marketing_v1_campaigns.sql", true],
    ["20261002000000_fix_email_marketing_x.sql", false], ["20260921055623_goal_engine_persistence_v1.sql", false]]) {
    assert.equal(isEmailMarketingFile(file), expected, file);
    assert.equal(isEmailMarketingName(file.slice(file.indexOf("_") + 1, -4)), expected, `${file} as a history row name`);
  }
  const moduleCode = readText(resolve(here, "email_marketing_v1_migration_order.mjs")).replace(/\/\/[^\n]*/g, "");
  assert.equal((moduleCode.match(/"email_marketing_"/g) || []).length, 1, "the Email Marketing name pattern is defined once (the predicate)");
  assert.ok(!/includes\(\s*["'`][^"'`]*email_marketing/.test(moduleCode), "no second, looser Email detection");
});

test("ordering (synthetic, parallel branches): legitimate migrations never fail; Email violations always do", () => {
  const worktree = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  const codex = STAGING_HISTORY_AT_INC3A.known_parallel_branch_migrations.files;
  const baseline = STAGING_HISTORY_AT_INC3A.staging_only_baseline_migrations.files;
  const historyThroughInc2 = STAGING_HISTORY_AT_INC3A.rows;
  const staging = historyThroughInc2.map(fileOf);
  const all = [INC1, INC2, INC3A];
  const legitimate = {
    "worktree + Codex goal-engine branch (before Inc1)": [...worktree, ...codex],
    "worktree + Staging-only baseline migrations": [...worktree, ...baseline],
    "full Staging history + Inc3a": [...staging, INC3A],
    "Staging history + Codex + Inc3a + later unrelated and later Email work": [...staging, ...codex, INC3A,
      "20261006000000_builder_x.sql", "20261007000000_email_marketing_v1_campaigns.sql"],
  };
  for (const [label, files] of Object.entries(legitimate)) {
    for (const prefix of [[INC1], [INC1, INC2], all]) assert.equal(emailOrderViolation(files, prefix, historyThroughInc2), null, `${label} (${prefix.length})`);
  }
  const base = [...worktree, ...codex];
  const violations = {
    "backdated unrelated migration between Inc1 and Inc2": [[...base, "20260926170000_backdated_builder.sql"], [INC1, INC2]],
    "Email migration inserted before Inc1": [[...base, "20260925000000_email_marketing_v1_early.sql"], [INC1]],
    "unchained Email migration before pending Inc3a": [[...base, "20260928000000_email_marketing_v1_extra.sql"], all],
    "missing Inc2 predecessor": [base.filter((f) => f !== INC2), all],
    "missing Inc1 predecessor": [base.filter((f) => f !== INC1), [INC1, INC2]],
    "duplicate Inc2": [[...base, INC2], all],
    "version collision with Inc1": [[...base, "20260926160000_other.sql"], [INC1]],
    "version collision after Inc3a (checked globally)": [[...base, "20261006000000_a.sql", "20261006000000_b.sql"], all],
  };
  for (const [label, [files, prefix]] of Object.entries(violations)) {
    assert.notEqual(emailOrderViolation(files, prefix, historyThroughInc2), null, label);
  }
  assert.notEqual(emailOrderViolation(base, [INC2, INC1], historyThroughInc2), null, "increments in the wrong order");
});

test("ordering (M3): the protected window follows the applied Email history, not pending files", () => {
  const worktree = [...STAGING_HISTORY_AT_INC3A.rows.map(fileOf), INC3A];
  const parallel = "20260928090000_builder_parallel.sql";
  const throughInc2 = STAGING_HISTORY_AT_INC3A.rows;
  const throughInc3a = [...throughInc2, { version: "20261004150000", name: "email_marketing_v1_senders_templates" }];
  const all = [INC1, INC2, INC3A];
  // Inc3a pending: a legitimate parallel migration dated between Inc2 and Inc3a passes.
  assert.equal(emailOrderViolation([...worktree, parallel], all, throughInc2), null, "pending Inc3a does not extend the window");
  // ...and applying it on Staging before Inc3a keeps the history valid.
  assert.equal(stagingHistoryViolation([...throughInc2, { version: "20260928090000", name: "builder_parallel" }]), null);
  // Once Inc3a is applied, the window extends: an unapplied file inside it now fails.
  assert.notEqual(emailOrderViolation([...worktree, parallel], all, throughInc3a), null, "applied Inc3a extends the window");
  assert.equal(emailOrderViolation(worktree, all, throughInc3a), null);
  // Inside the already-applied window (Inc1..Inc2) a backdated file always fails.
  assert.notEqual(emailOrderViolation([...worktree, "20260926170000_backdated.sql"], all, throughInc2), null);
  // A recorded migration newer than a pending increment makes it apply out of order.
  assert.notEqual(stagingHistoryViolation([...throughInc2, { version: "20261004200000", name: "later_builder" }]), null);
});

test("ordering (M2): refreshed Staging histories through Inc2, Inc3a and a future Inc4 all pass", () => {
  const INC4 = "20261015000000_email_marketing_v1_campaigns.sql";
  const chain4 = [INC1, INC2, INC3A, INC4];
  const throughInc2 = STAGING_HISTORY_AT_INC3A.rows;
  const throughInc3a = [...throughInc2, { version: "20261004150000", name: "email_marketing_v1_senders_templates" }];
  const throughInc4 = [...throughInc3a, { version: "20261006000000", name: "builder_later" }, { version: "20261015000000", name: "email_marketing_v1_campaigns" }];
  const files4 = [...[...STAGING_HISTORY_AT_INC3A.rows.map(fileOf), INC3A], "20261006000000_builder_later.sql", INC4];
  for (const [label, rows] of [["through Inc2", throughInc2], ["through Inc3a", throughInc3a], ["through Inc4", throughInc4]]) {
    assert.equal(stagingHistoryViolation(rows, chain4), null, label);
    for (const prefix of [[INC1], [INC1, INC2], [INC1, INC2, INC3A], chain4]) {
      assert.equal(emailOrderViolation(files4, prefix, rows, chain4), null, `${label}: ${prefix.length} increments`);
    }
  }
  // Earlier validators with the current chain also accept a history through Inc3a.
  assert.equal(stagingHistoryViolation(throughInc3a), null);
  // Still detected: missing or reordered predecessors in the recorded history.
  assert.notEqual(stagingHistoryViolation(throughInc3a.filter((r) => r.name !== "email_marketing_v1_audiences"), chain4), null, "Inc3a recorded without Inc2");
  assert.notEqual(stagingHistoryViolation(throughInc2.filter((r) => r.name !== "email_marketing_v1_foundation")), null, "Inc2 recorded without Inc1");
  assert.notEqual(stagingHistoryViolation([...throughInc2, { version: "20261015000000", name: "email_marketing_v1_campaigns" }], chain4), null,
    "Inc4 recorded before Inc3a");
  assert.notEqual(stagingHistoryViolation([...throughInc2, { version: "20261004150000", name: "email_marketing_v1_other" }]), null, "unknown Email migration recorded");
  // Interleaved migrations that were APPLIED are legitimate history; the same
  // file UNAPPLIED inside the applied window is backdated and fails.
  const interleaved = { version: "20261006000000", name: "builder_later" };
  assert.equal(emailOrderViolation(files4, chain4, throughInc4, chain4), null, "applied interleaved migration passes");
  assert.notEqual(emailOrderViolation(files4, chain4, throughInc4.filter((r) => r !== throughInc4.find((x) => x.version === interleaved.version)), chain4), null,
    "the same migration unapplied inside the applied window fails");
});

test("fix pass 5: header-only characters, locale independence, text-bearing block guard", () => {
  // Header fields additionally reject U+E0100-U+E01EF; parity with the contract.
  const headerBody = functionBlocks(raw).find((b) => b.name === "private.email_text_has_header_unsafe_chars").body;
  const extra = [...headerBody.matchAll(/chr\((\d+)\) \|\| '-' \|\| chr\((\d+)\)/g)].map((m) => `${Number(m[1]).toString(16).toUpperCase()}-${Number(m[2]).toString(16).toUpperCase()}`);
  assert.deepEqual(extra, ["E0100-E01EF"]);
  assert.ok(headerBody.includes("private.email_text_has_unsafe_chars(value, false)"), "header rule is a superset of the general set");
  const contract = readText(resolve(here, "../../docs/email-marketing/EMAIL_CONTENT_V1_CONTRACT.md"));
  const headerBullet = contract.slice(contract.indexOf("- **Campos de encabezado**"), contract.indexOf("\n- ", contract.indexOf("- **Campos de encabezado**") + 3));
  const docExtra = [...headerBullet.matchAll(/U\+([0-9A-F]{4,5})[\u2013-]U\+([0-9A-F]{4,5})/g)].map((m) => `${m[1]}-${m[2]}`);
  assert.deepEqual(docExtra, extra, "contract header-only ranges match SQL");
  assert.ok(blocks.find((b) => b.name === "private.email_header_text_problem").body.includes("private.email_text_has_header_unsafe_chars(value)"));
  assert.ok(blocks.find((b) => b.name === "private.email_from_name_is_valid").body.includes("private.email_text_has_header_unsafe_chars(value)"));
  // LOW 2: no locale-dependent character classes anywhere in the migration code.
  assert.ok(!code.includes("[[:cntrl:]]") && !/\[\[:[a-z]+:\]\]/.test(code), "no POSIX character classes in Increment 3a code");
  assert.ok(code.includes("and not private.email_text_has_unsafe_chars(name, false)"), "template name uses the explicit set");
  assert.ok(code.includes("and not private.email_text_has_unsafe_chars(description, false)"), "template description uses the explicit set");
  // Deferred re-listing guard: every block type whose text email_content_validate
  // validates is also re-checked (locked) by the version guard.
  const validateBody = blocks.find((b) => b.name === "private.email_content_validate").body;
  const validated = [...validateBody.matchAll(/block_type = '([a-z]+)' then\s+(?:if[\s\S]*?end if;\s+)?paths := paths \|\| private\.email_content_text\(/g)].map((m) => m[1]).sort();
  const guardBody = blocks.find((b) => b.name === "private.email_template_versions_guard").body;
  const locked = guardBody.match(/text_block\.block ->> 'type' in \(([^)]*)\)/)[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1)).sort();
  assert.deepEqual(validated, ["button", "heading", "paragraph"]);
  assert.deepEqual(locked, validated, "the guard re-checks exactly the text-bearing block types");
});

test("M3 (pass 6): the reviewed recovery baseline covers the current Staging history; the allowlist matches it", async () => {
  const { RECOVERY_BASELINE, RECOVERY_FILE, baselineVersions, recoveryBaselineInSql, recoveryBaselineViolation } =
    await import("./email_marketing_v1_recovery_baseline.mjs");
  assert.equal(RECOVERY_BASELINE.stage, "build-time", "the shipped baseline is labelled as a build-time snapshot");
  // Refresh rule: if the current Staging export holds a version the reviewed
  // baseline does not, the baseline must be refreshed (and the recovery
  // regenerated) before Increment 3a is applied.
  assert.equal(recoveryBaselineViolation(STAGING_HISTORY.rows, RECOVERY_BASELINE), null);
  assert.deepEqual(recoveryBaselineInSql(readText(RECOVERY_FILE)), [...baselineVersions(RECOVERY_BASELINE), INC3A.split("_")[0]].sort());
  // Synthetic: a legitimate parallel migration appears between build and apply.
  const { baselineDigest } = await import("./email_marketing_v1_recovery_baseline.mjs");
  const parallel = { version: "20261004000000", name: "builder_parallel" };
  const liveWithParallel = [...RECOVERY_BASELINE.rows, parallel];
  assert.notEqual(recoveryBaselineViolation(liveWithParallel, RECOVERY_BASELINE), null, "stale baseline is detected");
  const refreshed = { stage: "apply-time", rows: liveWithParallel };
  assert.equal(recoveryBaselineViolation(liveWithParallel, refreshed, { pinnedSha256: baselineDigest(liveWithParallel) }), null,
    "refreshed reviewed baseline (with its new pinned digest) accepts it");
  assert.equal(recoveryBaselineViolation([...RECOVERY_BASELINE.rows, { version: "20261004150000", name: "email_marketing_v1_senders_templates" }],
    RECOVERY_BASELINE), null, "Increment 3a itself never needs to be in the baseline");
});

test("A (pass 7): recovery baseline lifecycle - pre-Inc3a coverage only, frozen after Inc3a, later migrations never absorbed", async () => {
  const { RECOVERY_BASELINE, RECOVERY_BASELINE_SHA256, baselineDigest, baselineIntegrityViolation, recoveryBaselineViolation } =
    await import("./email_marketing_v1_recovery_baseline.mjs");
  const base = RECOVERY_BASELINE.rows;
  const inc3a = { version: "20261004150000", name: "email_marketing_v1_senders_templates" };
  const backdated = { version: "20260928150000", name: "codex_backdated" };
  const later1 = { version: "20261005160000", name: "email_marketing_v1_campaigns" };
  const later2 = { version: "20261006000000", name: "builder_parallel_later" };
  const check = (live, baseline = RECOVERY_BASELINE, pinned = RECOVERY_BASELINE_SHA256) =>
    recoveryBaselineViolation(live, baseline, { pinnedSha256: pinned });
  assert.equal(baselineDigest(base), RECOVERY_BASELINE_SHA256, "the shipped baseline matches its pinned digest");
  // 1. Inc3a not recorded + exact reviewed baseline.
  assert.equal(check([...base]), null, "1: exact reviewed baseline passes");
  // 2. Inc3a not recorded + unknown lower/backdated version.
  assert.match(check([...base, backdated]) || "", /refresh it from the target environment/, "2: unknown lower version fails");
  // 3. Inc3a recorded + one legitimate later migration: no baseline edit.
  assert.equal(check([...base, inc3a, later1]), null, "3: later migration passes without a baseline edit");
  // 4. Inc3a recorded + several legitimate later migrations.
  assert.equal(check([...base, inc3a, later1, later2]), null, "4: several later migrations pass");
  // 5. Inc3a recorded + newly introduced backdated version (with later migrations present).
  assert.match(check([...base, inc3a, later1, backdated]) || "", /FROZEN reviewed baseline/, "5: backdated version after Inc3a fails");
  //    ...and cannot be made green by adding it (or a later one) to the frozen baseline.
  const absorbed = [...base, backdated].sort((a, b) => (a.version < b.version ? -1 : 1));
  assert.match(check([...base, inc3a, backdated], { rows: absorbed }) || "", /pinned digest/, "5: absorbing the backdated version is tampering");
  assert.match(check([...base, inc3a, later1], { rows: [...base, later1] }, baselineDigest([...base, later1])) || "",
    /not below Increment 3a/, "5: later versions never belong in the baseline, even re-pinned");
  // 6. Reordering / removal / tampering of the reviewed pre-Inc3a history.
  const swapped = [...base];
  [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
  assert.match(baselineIntegrityViolation({ rows: swapped }, baselineDigest(swapped)) || "", /strictly ascending/, "6: reordered baseline");
  assert.match(check([...base.slice(0, 10), ...base.slice(11), inc3a]) || "", /missing from the history/, "6: removed history row");
  const renamed = base.map((row, i) => (i === 20 ? { ...row, name: `${row.name}_edited` } : row));
  assert.match(check([...renamed, inc3a]) || "", /not .* as reviewed/, "6: tampered history row");
  assert.match(check([...base, inc3a], { rows: base.slice(1) }) || "", /pinned digest/, "6: truncated baseline");
  assert.match(check([...base, inc3a], { rows: renamed }) || "", /pinned digest/, "6: edited baseline");
});

test("D (pass 7): locale-independence claims are limited to character validation; lower(name) is documented as locale-dependent", () => {
  const architecture = readText(resolve(here, "../../docs/email-marketing/ARCHITECTURE.md")).replace(/\s+/g, " ");
  const contract = readText(resolve(here, "../../docs/email-marketing/EMAIL_CONTENT_V1_CONTRACT.md")).replace(/\s+/g, " ");
  const migration = raw.replace(/\s+/g, " ");
  // No blanket claim: every "locale-independent"/"locale-free" statement is about characters or ordering.
  for (const [label, text] of [["migration", migration], ["ARCHITECTURE", architecture], ["contract", contract]]) {
    for (const m of text.matchAll(/(locale-free|locale-independent|independiente del locale|independencia del locale)/gi)) {
      if (/(not|no) $/i.test(text.slice(Math.max(0, m.index - 4), m.index))) continue; // a negation is not a claim
      const context = text.slice(Math.max(0, m.index - 120), m.index + 160).toLowerCase();
      assert.ok(/character|caracteres|conjunto|collation|order|cross-domain decision/.test(context), `${label}: "${m[0]}" is scoped: ...${context}...`);
    }
  }
  assert.ok(!/template RPC is (deterministic and )?locale-independent|RPC.{0,40}locale-free/i.test(migration + architecture), "no blanket RPC claim");
  assert.ok(migration.includes("Name uniqueness is NOT locale-independent") && migration.includes("lower() follows the database locale/collation"),
    "the migration documents lower(name)");
  assert.ok(architecture.includes("name_normalized = lower(name)") && architecture.includes("DEFER WITH REASON")
    && architecture.includes("se limita a la **validación de caracteres**"), "ARCHITECTURE documents the scope and the deferral");
  assert.ok(code.includes("name_normalized text generated always as (lower(name)) stored"), "semantics unchanged in this pass");
});

test("A (pass 7): the baseline tool refuses to rewrite a frozen baseline and --check verifies the pin", () => {
  const source = readText(resolve(here, "email_marketing_v1_recovery_baseline.mjs"));
  const write = source.slice(source.indexOf('process.argv[2] === "--write"'), source.indexOf('process.argv[2] === "--check"'));
  assert.ok(write.indexOf("inc3aRecorded(STAGING_HISTORY.rows)") > 0 && write.indexOf("inc3aRecorded(STAGING_HISTORY.rows)") < write.indexOf("writeFileSync"),
    "--write refuses before writing once Increment 3a is recorded");
  const checkBranch = source.slice(source.indexOf('process.argv[2] === "--check"'));
  assert.ok(checkBranch.includes("baselineIntegrityViolation(RECOVERY_BASELINE)"), "--check verifies the pinned digest");
});

test("fix pass 6: locale-free template RPC, single predicate, final-header authority, Unicode wording parity", () => {
  // MEDIUM 2: the template RPC never goes through the Increment 2 label helpers
  // (they use a locale-dependent POSIX class); it uses the explicit set.
  const createTemplate = blocks.find((b) => b.name === "public.email_create_template").body;
  assert.ok(!/email_clean_label|email_clean_description/.test(createTemplate), "no locale-dependent Increment 2 helper in the template RPC");
  assert.equal((createTemplate.match(/private\.email_text_has_unsafe_chars\(/g) || []).length, 2, "name and description use the explicit set");
  // LOW 2: one Email Marketing predicate; no Email validator re-implements it.
  for (const file of ["validate_email_marketing_v1_foundation.mjs", "validate_email_marketing_v1_audiences.mjs",
    "validate_email_marketing_v1_senders_templates.mjs", "email_marketing_v1_senders_templates.recovery.mjs"]) {
    const source = readText(resolve(here, file)).replace(/\/\/[^\n]*/g, "");
    assert.ok(!/startsWith\(\s*["'`]email_marketing|includes\(\s*["'`][^"'`]*email_marketing/.test(source), `${file} must use isEmailMarketingName/File`);
  }
  // MEDIUM 1: PostgreSQL authority for a FINAL rendered header value.
  const finalHeader = blocks.find((b) => b.name === "private.email_rendered_header_is_safe").body;
  assert.ok(finalHeader.includes("private.email_text_has_header_unsafe_chars(value)") && finalHeader.includes("strpos(value, '=?') = 0"),
    "final rendered subject/preheader: header set (incl. U+E0100-U+E01EF) and no encoded-word marker");
  const contract = readText(resolve(here, "../../docs/email-marketing/EMAIL_CONTENT_V1_CONTRACT.md"));
  assert.ok(contract.includes("RENDER_UNSAFE_HEADER") && contract.includes("private.email_rendered_header_is_safe"),
    "the contract makes final-header safety explicit and names the authority");
  // LOW 4: intended invariant = ZWJ/ZWNJ and U+FE00-U+FE0F allowed everywhere; only U+E0100-U+E01EF is body-only.
  const allowedEverywhere = contract.slice(contract.indexOf("- **Permitidos en todos los campos**"), contract.indexOf("\n- ", contract.indexOf("- **Permitidos en todos los campos**") + 3));
  const bodyOnly = contract.slice(contract.indexOf("- **Permitidos solo en el cuerpo**"), contract.indexOf("\n- ", contract.indexOf("- **Permitidos solo en el cuerpo**") + 3));
  const cps = (text) => [...text.matchAll(/U\+([0-9A-F]{4,5})(?:[\u2013-]U\+([0-9A-F]{4,5}))?/g)].map((m) => `${m[1]}-${m[2] ?? m[1]}`);
  assert.deepEqual(cps(allowedEverywhere), ["200C-200C", "200D-200D", "FE00-FE0F"]);
  assert.deepEqual(cps(bodyOnly), ["E0100-E01EF"]);
  assert.ok(!/solo en el cuerpo[^\n]*FE00|FE00[^\n]*solo en el cuerpo/.test(contract), "no wording that restricts FE00-FE0F to the body");
  const sqlComment = raw.slice(raw.indexOf("-- True when text contains characters"), raw.indexOf("create or replace function private.email_text_has_unsafe_chars"));
  assert.ok(sqlComment.includes("Allowed in every field") && sqlComment.includes("Allowed only in body text"), "SQL comment states the same two groups");
  const architecture = readText(resolve(here, "../../docs/email-marketing/ARCHITECTURE.md"));
  const archAllowed = architecture.slice(architecture.indexOf("Permitidos en todos los"), architecture.indexOf("(emoji y variantes"));
  assert.ok(archAllowed.includes("U+200C") && archAllowed.includes("U+200D") && archAllowed.includes("U+FE00"),
    "ARCHITECTURE.md states the same allowed-everywhere group");
  assert.ok(architecture.includes("el cuerpo los conserva") && architecture.includes("RENDER_UNSAFE_HEADER"),
    "ARCHITECTURE.md states the body-only group and the final-header rule");
});

test("contract parity: the forbidden-character set is identical in SQL, the SQL comment and the contract", () => {
  const toRanges = (pairs) => pairs.map(([a, b]) => `${a.toString(16).toUpperCase()}-${(b ?? a).toString(16).toUpperCase()}`).sort();
  // 1. Enforced SQL bracket expression.
  const body = functionBlocks(raw).find((b) => b.name === "private.email_text_has_unsafe_chars").body;
  const expr = body.slice(body.indexOf("~ ('[' ||") + "~ ('[' ||".length, body.indexOf("|| ']')"));
  const tokens = expr.split("||").map((t) => t.trim()).filter(Boolean);
  const sqlPairs = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const code = Number(tokens[i].match(/^chr\((\d+)\)$/)[1]);
    if (tokens[i + 1] === "'-'") {
      sqlPairs.push([code, Number(tokens[i + 2].match(/^chr\((\d+)\)$/)[1])]);
      i += 2;
    } else sqlPairs.push([code]);
  }
  // 2. The explanatory comment above the function.
  const header = raw.slice(raw.lastIndexOf("-- True when text contains characters", raw.indexOf("create or replace function private.email_text_has_unsafe_chars")),
    raw.indexOf("create or replace function private.email_text_has_unsafe_chars"));
  const commentPairs = [...header.matchAll(/^--\s+U\+([0-9A-F]{4,5})(?:-U\+([0-9A-F]{4,5}))?\s/gm)]
    .map((m) => [parseInt(m[1], 16), m[2] ? parseInt(m[2], 16) : undefined]);
  // 3. The normative contract list (section 3 bullet).
  const contract = readText(resolve(here, "../../docs/email-marketing/EMAIL_CONTENT_V1_CONTRACT.md"));
  const bulletStart = contract.indexOf("- Conjunto de caracteres prohibidos");
  const bullet = contract.slice(bulletStart, contract.indexOf("\n- ", bulletStart + 3));
  const docPairs = [...bullet.matchAll(/U\+([0-9A-F]{4,5})(?:[\u2013-]U\+([0-9A-F]{4,5}))?/g)]
    .map((m) => [parseInt(m[1], 16), m[2] ? parseInt(m[2], 16) : undefined]);
  assert.ok(sqlPairs.length >= 20);
  assert.deepEqual(toRanges(commentPairs), toRanges(sqlPairs), "SQL comment matches the enforced set");
  assert.deepEqual(toRanges(docPairs), toRanges(sqlPairs), "contract section 3 matches the enforced set");
  const architecture = readText(resolve(here, "../../docs/email-marketing/ARCHITECTURE.md"));
  assert.ok(!/U\+E0000/.test(architecture) && architecture.includes("EMAIL_CONTENT_V1_CONTRACT.md"),
    "ARCHITECTURE.md does not keep its own copy of the list; it points to the contract");
});

test("fix pass 3 contracts: encoded words, invisible set, domain cap, actor, single audit-time validation, locations", () => {
  const validate = blocks.find((b) => b.name === "private.email_content_validate").body;
  const headerHelper = blocks.find((b) => b.name === "private.email_header_text_problem").body;
  assert.ok(headerHelper.includes("strpos(value, '=?') > 0 then 'encoded words are not allowed'"), "RFC 2047 markers are rejected");
  assert.ok(validate.includes("private.email_header_text_problem(subject, 200)") && validate.includes("private.email_header_text_problem(preheader, 250)"),
    "the validator uses the shared header helper for subject and preheader");
  assert.ok(!/strpos\(subject|strpos\(preheader|char_length\(subject\)|char_length\(preheader\)/.test(validate), "no duplicated header checks in the validator");
  assert.ok(blocks.find((b) => b.name === "private.email_header_text_is_valid").body.includes("private.email_header_text_problem(value, max_length) is null"),
    "the column CHECK helper uses the same authority");
  assert.ok(code.includes("subject text not null check (private.email_header_text_is_valid(subject, 200))"));
  const domain = blocks.find((b) => b.name === "private.email_normalize_domain").body;
  assert.ok(domain.includes("char_length(candidate) > 252"), "sender domains are capped at the usable 252 characters");
  const guard = blocks.find((b) => b.name === "private.email_template_versions_guard").body;
  assert.ok(guard.includes("new.created_by is distinct from (select auth.uid())") && guard.includes("'email_actor_mismatch'"), "created_by must equal the session actor");
  assert.ok(guard.includes("new.merge_tag_count :=") && guard.includes("new.merge_tags_sha256 :="), "guard stores bounded merge-tag evidence");
  assert.ok(/private\.email_merge_tag_paths\(new\.organization_id, tag_location, tag_text\)/.test(guard), "re-check uses the validator's locations");
  const advance = blocks.find((b) => b.name === "private.email_template_versions_advance").body;
  assert.ok(!advance.includes("email_content_validate"), "the AFTER trigger does not re-validate (the guard is the boundary)");
  assert.ok(advance.includes("new.merge_tag_count") && advance.includes("new.merge_tags_sha256"));
  const rpc = blocks.find((b) => b.name === "public.email_create_template_version").body;
  assert.equal((rpc.match(/private\.email_content_validate\(/g) || []).length, 1, "the RPC validates once (error precedence)");
  assert.equal((guard.match(/private\.email_content_validate\(/g) || []).length, 1, "the guard validates once (authoritative)");
});

test("scope: four new tables; only email_can and the audit entity-type check touch earlier objects", () => {
  const created = [...code.matchAll(/create table ([a-z_.]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(created, TABLES.map((t) => `public.${t}`).sort());
  const altered = [...code.matchAll(/alter table ([a-z_.]+)/g)].map((m) => m[1]);
  for (const table of altered) {
    assert.ok(table === "public.email_audit_log" || TABLES.includes(table.replace("public.", "")), `alters ${table}`);
  }
  const earlier = new Set([...functionBlocks(inc1Code), ...functionBlocks(inc2Code)].map((b) => b.name));
  const redefined = blocks.map((b) => b.name).filter((name) => earlier.has(name));
  assert.deepEqual(redefined, ["private.email_can"], "only email_can is redefined");
  assert.ok(!/drop (table|function|policy|trigger|index|view|schema)/.test(code), "nothing is dropped");
  assert.equal((code.match(/drop constraint/g) || []).length, 1);
  assert.ok(code.includes("drop constraint email_audit_log_entity_type_check,\n  add constraint email_audit_log_entity_type_check check (entity_type in ("));
  for (const type of ["contact", "consent", "suppression", "list", "tag", "custom_field", "segment", "crm_import",
    "sender_domain", "sender_identity", "template", "template_version"]) {
    assert.ok(code.includes(`'${type}'`), `audit entity type ${type}`);
  }
  assert.ok(!code.includes("'campaign'"), "campaign objects belong to Increment 3c");
});

test("email_can: identical to Increment 1 except exactly three added actions", () => {
  const before = functionBlocks(inc1Code).find((b) => b.name === "private.email_can");
  const after = blocks.find((b) => b.name === "private.email_can");
  assert.equal(after.header, before.header, "same signature, volatility, definer and search_path");
  assert.equal(after.args, before.args);
  const added = "',\n      'manage_senders',\n      'manage_content',\n      'manage_campaigns'";
  assert.ok(after.body.includes(added));
  assert.equal(after.body.replace(added, "'"), before.body, "body differs only by the three actions");
  assert.ok(code.includes("revoke all on function private.email_can(text) from public, anon, authenticated, service_role;\ngrant execute on function private.email_can(text) to authenticated;"));
});

test("no foreign dependencies, dynamic SQL, secrets, providers or network", () => {
  for (const forbidden of [
    "is_platform_owner", "member_module_access", "has_active_module_access", "handle_new_user",
    "orb_action_proposals", "goal_engine", "builder_", "can_manage_organization", "public.clients",
    "pg_net", "net.http", "cron.schedule", "vault.", "dblink", "http_get", "http_post",
    "api_key", "apikey", "password", "secret", "smtp", "resend", "sendgrid", "mailgun", "brevo", "http://",
  ]) {
    assert.ok(!code.includes(forbidden), `must not reference ${forbidden}`);
  }
  assert.ok(!/\bexecute\s+(format|'|\$|[a-z_]+\s*;)/.test(code), "no dynamic SQL");
  assert.ok(!/security definer[\s\S]{0,200}set search_path = 'public'/.test(code));
});

test("RLS: enabled on every new table, SELECT-only, tenant + email_can('read')", () => {
  for (const table of TABLES) {
    assert.ok(code.includes(`alter table public.${table} enable row level security`), table);
    assert.ok(code.includes(`create policy ${table}_select on public.${table}\nfor select to authenticated`), table);
  }
  const policies = [...code.matchAll(/create policy [\s\S]*?\);/g)].map((m) => m[0]);
  assert.equal(policies.length, TABLES.length);
  for (const policy of policies) {
    assert.ok(!/\nfor (insert|update|delete|all)\b/.test(policy));
    assert.ok(policy.includes("organization_id = (select public.current_user_organization_id())"));
    assert.ok(policy.includes("(select private.email_can('read'))"));
  }
});

test("tenant-consistent composite foreign keys; every table is organization-owned", () => {
  for (const [child, parent] of [["email_sender_identities", "email_sender_domains"], ["email_template_versions", "email_templates"]]) {
    const start = code.indexOf(`create table public.${child}`);
    const block = code.slice(start, code.indexOf(");\n", start));
    assert.ok(new RegExp(`foreign key \\(organization_id, [a-z_]+_id\\)\\s+references public\\.${parent} \\(organization_id, id\\) on delete restrict`).test(block), `${child} -> ${parent}`);
  }
  for (const table of TABLES) {
    const start = code.indexOf(`create table public.${table}`);
    const block = code.slice(start, code.indexOf(");\n", start));
    assert.ok(block.includes("organization_id uuid not null"), table);
    assert.ok(block.includes("unique (organization_id, id)"), table);
  }
});

test("grants: SELECT only for authenticated/service_role; nothing for anon", () => {
  assert.ok(!/grant (insert|update|delete|truncate|all)[^;]*on (table )?public\.email_/.test(code));
  assert.ok(!/grant [^;]* to [^;]*\banon\b/.test(code));
  assert.ok(code.includes("from public, anon, authenticated, service_role;\ngrant select on table public.email_sender_domains"));
});

test("functions: pinned search_path, owner, explicit revokes, minimal grants, definer only for RPCs", () => {
  const names = blocks.map((b) => b.name);
  for (const rpc of RPCS) assert.ok(names.includes(`public.${rpc}`), rpc);
  for (const block of blocks) {
    assert.ok(block.header.includes("set search_path = ''"), `${block.name} search_path`);
    const escaped = block.name.replace(".", "\\.");
    assert.ok(new RegExp(`alter function ${escaped}\\([^)]*\\) owner to postgres;`).test(code), `${block.name} owner`);
    assert.ok(new RegExp(`revoke all on function ${escaped}\\([^)]*\\) from public, anon, authenticated, service_role;`).test(code), `${block.name} revoke`);
  }
  const definers = blocks.filter((b) => b.header.includes("security definer")).map((b) => b.name).sort();
  assert.deepEqual(definers, ["private.email_can", ...RPCS.map((r) => `public.${r}`)].sort());
  const grants = [...code.matchAll(/grant execute on function ([a-z_.]+)\([^)]*\) to ([a-z_, ]+);/g)].map((m) => `${m[1]}:${m[2]}`).sort();
  assert.deepEqual(grants, ["private.email_can:authenticated", ...RPCS.map((r) => `public.${r}:authenticated`)].sort());
});

test("RPCs authorize first with the semantic action; organization/actor derived server-side", () => {
  for (const block of blocks.filter((b) => b.name.startsWith("public."))) {
    assert.ok(!/organization|actor|user_id|created_by/.test(block.args), `${block.name} identity arg`);
    const auth = block.body.match(/private\.email_require\('([a-z_]+)'\)/);
    assert.ok(auth && block.body.indexOf(auth[0]) < block.body.indexOf("\nbegin"), `${block.name} authorizes in declare`);
    const rpc = block.name.replace("public.", "");
    const expected = SENDER_RPCS.includes(rpc) ? "manage_senders" : CONTENT_RPCS.includes(rpc) ? "manage_content" : "read";
    assert.equal(auth[1], expected, `${block.name} uses ${expected}`);
    assert.ok(!block.body.includes("'manage_contacts'"), `${block.name} does not reuse manage_contacts`);
    assert.ok(!/p_(status|verification_status|version_number|content_sha256|created_at)/.test(block.args), `${block.name} exposes no reserved field`);
  }
});

test("concurrency: row locks and unique backstops", () => {
  const body = (name) => blocks.find((b) => b.name === name).body;
  for (const name of ["public.email_archive_sender_domain", "public.email_update_sender_identity", "public.email_archive_sender_identity",
    "public.email_archive_template", "public.email_create_template_version", "private.email_template_versions_guard"]) {
    assert.ok(body(name).includes("for update"), `${name} locks the row`);
  }
  assert.ok(body("public.email_create_sender_identity").includes("for share"), "identity creation share-locks the domain");
  assert.ok(body("private.email_sender_identities_domain_guard").includes("for share"));
  assert.ok(code.includes("unique (organization_id, template_id, version_number)"));
  for (const index of ["email_sender_domains_active_domain_key", "email_sender_identities_active_address_key", "email_templates_active_name_key"]) {
    assert.ok(code.includes(`create unique index ${index}`), index);
  }
  assert.ok(body("public.email_create_template_version").includes("p_expected_latest_version is null"), "expected version is required");
});

test("M3: idempotent creates retry a bounded number of times, then fail retryably (never zero rows)", () => {
  for (const name of ["public.email_create_sender_domain", "public.email_create_sender_identity", "public.email_create_template"]) {
    const body = blocks.find((b) => b.name === name).body;
    assert.equal((body.match(/for attempt in 1\.\.3 loop/g) || []).length, 1, `${name} has one bounded retry loop`);
    const loop = body.slice(body.indexOf("for attempt in 1..3 loop"), body.indexOf("end loop;"));
    assert.ok(loop.includes("on conflict") && loop.includes("status = 'active'"), `${name}: insert and lookup are inside the loop`);
    assert.ok(/(if existing_id is not null then|if found then)/.test(loop), `${name}: returns only a row that was found`);
    const after = body.slice(body.indexOf("end loop;"));
    assert.ok(after.includes("errcode = '40001', message = 'email_concurrent_modification'"), `${name}: retryable failure after the loop`);
    assert.ok(!/return query\s+select [a-z_.]+, false from/.test(body), `${name}: no unconditional lookup return`);
  }
});

test("M2: exact retries precede validation; referenced custom fields are share-locked in the guard", () => {
  const rpc = blocks.find((b) => b.name === "public.email_create_template_version").body;
  const idempotent = rpc.indexOf("if latest.content_sha256 = payload_hash then");
  assert.ok(idempotent > 0 && idempotent < rpc.indexOf("private.email_content_validate("), "exact-retry check runs before validation");
  assert.ok(rpc.indexOf("private.email_content_validate(") < rpc.indexOf("p_expected_latest_version <> template_row.latest_version"),
    "new content is validated before the conflict check");
  const guard = blocks.find((b) => b.name === "private.email_template_versions_guard").body;
  assert.ok(/from public\.email_custom_field_definitions as field[\s\S]*?field\.status = 'active'\s+for share;/.test(guard),
    "guard share-locks each referenced active custom field");
});

test("invariants: lifecycle guards, append-only versions, server-side hash, reserved states", () => {
  for (const fragment of [
    "create trigger email_sender_domains_guard\nbefore insert or update or delete on public.email_sender_domains\nfor each row execute function private.email_catalog_guard('domain', 'verification_status');",
    "create trigger email_sender_identities_guard\nbefore insert or update or delete on public.email_sender_identities\nfor each row execute function private.email_catalog_guard('domain_id', 'local_part', 'address');",
    "create trigger email_templates_guard\nbefore insert or update or delete on public.email_templates\nfor each row execute function private.email_catalog_guard('name', 'description');",
    "create trigger email_template_versions_immutable\nbefore update or delete on public.email_template_versions",
    "create trigger email_template_versions_no_truncate\nbefore truncate on public.email_template_versions",
    "create trigger email_template_versions_guard\nbefore insert on public.email_template_versions",
    "create trigger email_sender_domains_archive_guard\nbefore update on public.email_sender_domains",
    "create trigger email_sender_identities_domain_guard\nbefore insert on public.email_sender_identities",
    "create trigger email_templates_latest_guard\nbefore insert or update on public.email_templates",
    "verification_status text not null default 'unverified' check (verification_status in ('unverified'))",
    "new.content_sha256 := private.email_template_content_hash(new.subject, new.preheader, new.content);",
    "merge_tags := private.email_content_validate(new.organization_id, new.subject, new.preheader, new.content);",
  ]) assert.ok(code.includes(fragment), fragment);
  for (const table of ["email_sender_domains", "email_sender_identities", "email_templates"]) {
    assert.ok(code.includes(`create trigger ${table}_no_truncate before truncate on public.${table}`), table);
  }
});

test("content policy: no raw HTML, https/mailto only, merge tags never in URLs, header-safe text", () => {
  const validate = blocks.find((b) => b.name === "private.email_content_validate").body;
  assert.ok(validate.includes("private.email_url_is_allowed(block ->> 'url', true)"));
  assert.ok(validate.includes("private.email_url_is_allowed(block ->> 'src', false)"), "images are https only");
  assert.ok(validate.includes("octet_length(content::text) > 65536"));
  assert.ok(validate.includes("jsonb_array_length(content -> 'blocks') not between 1 and 100"));
  assert.ok(!validate.includes("'html'"), "no html block type");
  const url = blocks.find((b) => b.name === "private.email_url_is_allowed").body;
  assert.ok(url.includes("(:[0-9]{1,5})?([/?#][a-za-z0-9._~:/?#@!$&()*+,;=%-]*)?$'"),
    "https path charset: no quotes, spaces, backslashes, angle brackets or braces");
  assert.ok(url.includes("'^[a-za-z0-9._+-]+@[a-za-z0-9.-]+$'"), "mailto: single plain address, no query");
  assert.equal((url.match(/return true/g) || []).length, 0, "no unconditional accept");
  const unsafe = blocks.find((b) => b.name === "private.email_text_has_unsafe_chars").body;
  // L1: C0, DEL+C1, ALM, ZWSP, LRM/RLM, separators+bidi overrides, U+2060-206F, BOM, interlinear annotations.
  const expectedSet = "'[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || chr(173) || chr(847) || chr(1564)\n"
    + "         || chr(4447) || '-' || chr(4448) || chr(6068) || '-' || chr(6069) || chr(6155) || '-' || chr(6159) || chr(8203)\n"
    + "         || chr(8206) || '-' || chr(8207) || chr(8232) || '-' || chr(8238) || chr(8288) || '-' || chr(8303)\n"
    + "         || chr(10240) || chr(12644) || chr(65279) || chr(65440) || chr(65520) || '-' || chr(65531)\n"
    + "         || chr(113824) || '-' || chr(113827) || chr(119155) || '-' || chr(119162)\n"
    + "         || chr(917504) || '-' || chr(917759) || chr(918000) || '-' || chr(921599) || ']'";
  assert.ok(unsafe.includes(expectedSet), "unsafe character set is exactly the documented one");
  const rawHtml = blocks.find((b) => b.name === "private.email_text_has_raw_html").body;
  assert.ok(rawHtml.includes("regexp_replace(value, '\\{\\{[^{}]*\\}\\}', 'x', 'g') ~ '<[ \\n]*[a-za-z!/?]'"),
    "H1: raw HTML is also checked with merge tags substituted");
  const validateBody = blocks.find((b) => b.name === "private.email_content_validate").body;
  assert.ok(validateBody.includes("order by tag_path collate \"c\""), "M4: merge-tag order is bytewise (C collation)");
  assert.ok(!/order by [a-z_]+\)/.test(validateBody), "M4: no ordering under the default collation");
  const validators = ["private.email_text_has_unsafe_chars", "private.email_merge_tag_paths", "private.email_content_text",
    "private.email_content_validate", "private.email_from_name_is_valid", "private.email_header_text_is_valid"];
  for (const name of validators) {
    assert.ok(!blocks.find((b) => b.name === name).body.includes("[[:cntrl:]]"), `${name} must not rely on locale-dependent [[:cntrl:]]`);
  }
  assert.ok(code.includes("value !~ '[<>\"\\\\@]'"), "display name cannot carry an address");
  assert.ok(blocks.find((b) => b.name === "private.email_from_name_is_valid").body.includes("strpos(value, '=?') = 0"),
    "display name cannot carry RFC 2047 encoded words");
  const domain = blocks.find((b) => b.name === "private.email_normalize_domain").body;
  const inc1Domain = inc1Code.match(/domain_part !~ '(\^[^']+\$)'/)[1];
  assert.ok(domain.includes(`candidate !~ '${inc1Domain}'`), "domain labels use exactly the Increment 1 domain pattern");
  assert.ok(domain.includes("char_length(candidate) > 252"), "usable limit: a 1-character local part + '@' + 252 = 254");
  const merge = blocks.find((b) => b.name === "private.email_merge_tag_paths").body;
  assert.ok(merge.includes("'contact.first_name', 'contact.last_name', 'contact.email', 'organization.name'"));
  assert.ok(merge.includes("field.status = 'active'") && merge.includes("field.organization_id = target_organization_id"));
});

test("audit: every mutation audits once; addresses only as hashes; no content in details", () => {
  for (const rpc of [...SENDER_RPCS, ...CONTENT_RPCS].filter((r) => r !== "email_create_template_version")) {
    assert.ok(blocks.find((b) => b.name === `public.${rpc}`).body.includes("private.email_write_audit("), `${rpc} audits`);
  }
  // M6: version creation is audited once, by the AFTER INSERT trigger (only rows that were inserted),
  // never by the BEFORE guard (fires for rows ON CONFLICT DO NOTHING skips) nor again by the RPC.
  assert.ok(!blocks.find((b) => b.name === "public.email_create_template_version").body.includes("email_write_audit"), "no duplicate RPC audit");
  assert.ok(!blocks.find((b) => b.name === "private.email_template_versions_guard").body.includes("email_write_audit"), "no audit in the BEFORE guard");
  const advance = blocks.find((b) => b.name === "private.email_template_versions_advance").body;
  assert.ok(advance.includes("private.email_write_audit(new.organization_id, 'email.template_version.created', 'template_version', new.id,"));
  assert.ok(code.includes("create trigger email_template_versions_advance\nafter insert on public.email_template_versions\nfor each row"));
  // M1: bounded evidence only, computed by the guard and read from the row.
  assert.ok(advance.includes("'merge_tag_count', new.merge_tag_count") && advance.includes("'merge_tags_sha256', new.merge_tags_sha256"));
  const versionGuard = blocks.find((b) => b.name === "private.email_template_versions_guard").body;
  assert.ok(versionGuard.includes("new.merge_tag_count := cardinality(merge_tags);"));
  const auditCalls = [...code.matchAll(/private\.email_write_audit\(([\s\S]*?)\);/g)].map((m) => m[1]);
  assert.ok(auditCalls.length >= 8);
  assert.ok(auditCalls.every((call) => !/'merge_tags',/.test(call)), "no unbounded merge-tag list in audit details");
  const update = blocks.find((b) => b.name === "public.email_update_sender_identity").body;
  assert.ok(update.includes("private.email_address_hash(next_reply_to)") && update.includes("'reply_to_cleared'"), "M6: reply_to changes are evidenced by hash");
  assert.ok(!blocks.find((b) => b.name === "public.email_validate_content").body.includes("email_write_audit"), "validation never writes");
  const audits = [...code.matchAll(/private\.email_write_audit\(([\s\S]*?)\);/g)].map((m) => m[1]);
  for (const call of audits) {
    assert.ok(!/'(address|reply_to|email|subject|preheader|content|text|from_name)', /.test(call), `raw value in audit: ${call}`);
  }
  assert.ok(code.includes("'address_hash', private.email_address_hash(sender_address)"));
});
