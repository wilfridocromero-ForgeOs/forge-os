// Migration-order rules for Email Marketing V1 increments.
//
// Sources and what each is authoritative for:
// * EMAIL_CHAIN below (this repository): every Email Marketing increment, in
//   order. Adding an increment means appending it here.
// * fixtures/email_marketing_v1_staging_history.json: the CURRENT read-only
//   export of supabase_migrations.schema_migrations on Staging, i.e. what is
//   APPLIED. It is refreshed whenever Staging history changes; every rule below
//   must hold for any refreshed history.
// * fixtures/email_marketing_v1_staging_history_2026-09-29.json: an IMMUTABLE
//   historical snapshot (history present when Increment 3a was built). Only
//   historical assertions and the Increment 3a recovery use it.
//
// Rules, for the increments a validator owns (a prefix of EMAIL_CHAIN):
// 1. every increment exists exactly once (exact file name), and versions are
//    strictly increasing in chain order;
// 2. migration version prefixes are unique across ALL migration files;
// 3. no Email Marketing migration outside EMAIL_CHAIN sorts at or before the
//    last increment;
// 4. protected window: between the first increment and the LAST increment
//    actually RECORDED in the Staging history (first exclusive, last
//    inclusive), every migration file must already be recorded (applied). An
//    unrecorded file there is backdated: it would be applied out of order
//    after a later Email increment. Recorded interleaved migrations are
//    legitimate history (versions carry no apply time). A pending (unrecorded)
//    increment never extends the window, so legitimate parallel migrations
//    dated before a pending increment are allowed;
// 5. Staging history: the recorded Email migrations are exactly a prefix of
//    EMAIL_CHAIN (matching version and name), and every pending increment
//    sorts after the latest recorded version, so it applies in order.
// Migrations before the first increment (baseline, Builder, Codex...) are not
// constrained.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Every Email test reads text through this helper: with core.autocrlf=true a
// fresh Windows checkout turns LF into CRLF, and source-matching assertions
// must behave identically either way. It never changes files on disk.
export const readText = (path) => readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
const fixture = (name) => JSON.parse(readText(resolve(here, "fixtures", name)));
export const MIGRATIONS_DIR = resolve(here, "../migrations");
export const STAGING_HISTORY = fixture("email_marketing_v1_staging_history.json");
export const STAGING_HISTORY_AT_INC3A = fixture("email_marketing_v1_staging_history_2026-09-29.json");

export const INC1 = "20260926160000_email_marketing_v1_foundation.sql";
export const INC2 = "20260927120000_email_marketing_v1_audiences.sql";
export const INC3A = "20261004150000_email_marketing_v1_senders_templates.sql";
export const EMAIL_CHAIN = [INC1, INC2, INC3A];

export const versionOf = (file) => file.split("_")[0];
export const nameOf = (file) => file.slice(file.indexOf("_") + 1).replace(/\.sql$/, "");
export const fileOf = (row) => `${row.version}_${row.name}.sql`;
// The single predicate for "is an Email Marketing migration", for files and
// for Staging history rows alike.
export const isEmailMarketingName = (name) => name.startsWith("email_marketing_");
export const isEmailMarketingFile = (file) => isEmailMarketingName(nameOf(file));

const recordedSet = (rows) => new Set(rows.map(fileOf));

// Returns null when `files` satisfies rules 1-4 for `increments`, otherwise a
// description of the first violation. `rows` is the Staging history.
export function emailOrderViolation(files, increments, rows = STAGING_HISTORY.rows, chain = EMAIL_CHAIN) {
  const sql = files.filter((f) => f.endsWith(".sql"));
  const versions = sql.map(versionOf);
  if (new Set(versions).size !== versions.length) return "duplicate migration version prefix";
  for (const increment of increments) {
    const count = sql.filter((f) => f === increment).length;
    if (count !== 1) return `${increment} must exist exactly once (found ${count})`;
  }
  for (let i = 1; i < increments.length; i += 1) {
    if (!(versionOf(increments[i - 1]) < versionOf(increments[i]))) return `${increments[i]} must sort after ${increments[i - 1]}`;
  }
  const last = versionOf(increments[increments.length - 1]);
  const foreignEmail = sql.find((f) => isEmailMarketingFile(f) && !chain.includes(f) && versionOf(f) <= last);
  if (foreignEmail) return `${foreignEmail} is an Email Marketing migration outside the chain at or before ${increments[increments.length - 1]}`;
  const recorded = recordedSet(rows);
  const applied = increments.filter((f) => recorded.has(f));
  if (applied.length > 0) {
    const first = versionOf(increments[0]);
    const appliedEnd = versionOf(applied[applied.length - 1]);
    const intruder = sql.find((f) => versionOf(f) > first && versionOf(f) <= appliedEnd && !increments.includes(f) && !recorded.has(f));
    if (intruder) return `${intruder} is not applied but sorts inside the applied Email window (${first}, ${appliedEnd}]`;
  }
  return null;
}

// Rule 5 on a Staging history (any refresh of it). Returns null or a violation.
export function stagingHistoryViolation(rows, chain = EMAIL_CHAIN) {
  const versions = rows.map((r) => r.version);
  if (new Set(versions).size !== versions.length) return "duplicate version recorded";
  const recordedEmail = [...rows].sort((a, b) => (a.version < b.version ? -1 : 1)).filter((r) => isEmailMarketingName(r.name));
  for (let i = 0; i < recordedEmail.length; i += 1) {
    if (!chain[i] || fileOf(recordedEmail[i]) !== chain[i]) {
      return `recorded Email migration ${fileOf(recordedEmail[i])} is not chain position ${i} (${chain[i] ?? "none"})`;
    }
  }
  const latest = [...versions].sort().at(-1);
  const pending = chain.slice(recordedEmail.length).find((f) => !(versionOf(f) > latest));
  if (pending) return `${pending} is pending but does not sort after the latest recorded version ${latest}`;
  return null;
}

export const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
