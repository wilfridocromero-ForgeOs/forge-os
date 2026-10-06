// Reviewed recovery baseline for the Increment 3a controlled Staging recovery.
//
// The recovery accepts only migration versions in its allowlist
// (EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION otherwise). That allowlist is the
// REVIEWED RECOVERY BASELINE plus Increment 3a. The baseline covers ONLY
// versions below Increment 3a; versions after it are governed by the
// recovery's LATER_MIGRATION refusal and by the migration-order rules, never
// by this baseline.
//
// Lifecycle:
// * BEFORE Increment 3a is recorded in the target history: the baseline shipped
//   with the code is a BUILD-TIME snapshot and is not guaranteed to be the
//   history at apply time. Immediately before Increment 3a is applied to a
//   real environment, export that environment's history
//   (`select version, name from supabase_migrations.schema_migrations order by version;`),
//   review it, store the rows below Increment 3a as
//   fixtures/email_marketing_v1_recovery_baseline.json, then run
//     node supabase/tests/email_marketing_v1_recovery_baseline.mjs --write
//   and update RECOVERY_BASELINE_SHA256 to the digest it prints.
// * AFTER Increment 3a is recorded: the baseline is FROZEN. --write refuses,
//   later migrations need no baseline edit (they are ignored here), and a
//   version below Increment 3a that is not in the baseline is a backdated
//   migration: it fails closed and must be reverted, never added to the
//   baseline. Changing the frozen baseline requires editing the fixture, the
//   recovery allowlist and the pinned digest together, which code review sees.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INC3A, STAGING_HISTORY, readText, versionOf } from "./email_marketing_v1_migration_order.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const RECOVERY_FILE = resolve(here, "../recovery/20261004150000_email_marketing_v1_senders_templates.down.sql");
export const RECOVERY_BASELINE = JSON.parse(readText(resolve(here, "fixtures/email_marketing_v1_recovery_baseline.json")));
// Digest of the reviewed baseline rows (see baselineDigest). Pinned so the
// baseline cannot be edited (e.g. to absorb a backdated migration) without a
// visible change here.
export const RECOVERY_BASELINE_SHA256 = "1c01d8b52e7dd4a8daa998217d48e6f2793e52e4c223cecaa726accc1b4caa50";
const BEGIN = "-- BEGIN REVIEWED RECOVERY BASELINE";
const END = "-- END REVIEWED RECOVERY BASELINE";
const NL = String.fromCharCode(10);
const INC3A_VERSION = versionOf(INC3A);

export const baselineVersions = (baseline) => baseline.rows.map((row) => row.version);
export const baselineDigest = (rows) =>
  createHash("sha256").update(rows.map((row) => `${row.version} ${row.name}`).join(NL), "utf8").digest("hex");
export const inc3aRecorded = (rows) => rows.some((row) => row.version === INC3A_VERSION);

// Versions accepted by a recovery script (between the markers), sorted.
export function recoveryBaselineInSql(sql) {
  const start = sql.indexOf(BEGIN);
  const end = sql.indexOf(END);
  if (start < 0 || end < start) throw new Error("recovery baseline markers not found");
  return [...sql.slice(start, end).matchAll(/'([0-9]+)'/g)].map((m) => m[1]).sort();
}

// The same recovery script with its allowlist replaced by `versions` + Inc3a.
export function recoverySqlWithBaseline(sql, versions) {
  const start = sql.indexOf(BEGIN);
  const end = sql.indexOf(END);
  if (start < 0 || end < start) throw new Error("recovery baseline markers not found");
  const all = [...new Set([...versions, INC3A_VERSION])].sort();
  const lines = [];
  let current = "";
  for (const item of all.map((v) => `'${v}'`)) {
    if ((current + item).length > 96) {
      lines.push(current.trimEnd());
      current = "";
    }
    current += `${item}, `;
  }
  lines.push(current.slice(0, -2));
  return `${sql.slice(0, start + BEGIN.length)}${NL}        ${lines.join(`${NL}        `)}${NL}        ${sql.slice(end)}`;
}

// Integrity of the reviewed baseline itself: strictly ascending, unique,
// every version below Increment 3a, and equal to the pinned digest.
export function baselineIntegrityViolation(baseline, pinnedSha256 = RECOVERY_BASELINE_SHA256) {
  const rows = baseline.rows;
  if (!Array.isArray(rows) || rows.length === 0) return "the reviewed baseline has no rows";
  for (let i = 0; i < rows.length; i += 1) {
    const { version, name } = rows[i];
    if (typeof version !== "string" || !/^[0-9]+$/.test(version) || typeof name !== "string") {
      return `baseline row ${i} is malformed`;
    }
    if (version >= INC3A_VERSION) {
      return `${version}_${name} is not below Increment 3a: later migrations never belong in the reviewed baseline`;
    }
    if (i > 0 && rows[i - 1].version >= version) return `baseline rows are not strictly ascending at ${version}_${name}`;
  }
  if (baselineDigest(rows) !== pinnedSha256) {
    return "the reviewed baseline does not match its pinned digest (edited, reordered or truncated)";
  }
  return null;
}

// Null when `liveRows` (a target history export) is consistent with the
// reviewed baseline under the lifecycle above; otherwise the reason.
export function recoveryBaselineViolation(liveRows, baseline, { pinnedSha256 = RECOVERY_BASELINE_SHA256 } = {}) {
  const integrity = baselineIntegrityViolation(baseline, pinnedSha256);
  if (integrity) return integrity;
  const recorded = inc3aRecorded(liveRows);
  const live = new Map(liveRows.map((row) => [row.version, row.name]));
  for (const row of baseline.rows) {
    if (!live.has(row.version)) return `${row.version}_${row.name} from the reviewed baseline is missing from the history`;
    if (live.get(row.version) !== row.name) {
      return `${row.version} is recorded as ${live.get(row.version)}, not ${row.name} as reviewed`;
    }
  }
  const known = new Set(baselineVersions(baseline));
  const unknown = [...liveRows].sort((a, b) => (a.version < b.version ? -1 : 1))
    .find((row) => row.version < INC3A_VERSION && !known.has(row.version));
  if (!unknown) return null;
  return recorded
    ? `${unknown.version}_${unknown.name} is below Increment 3a but outside the FROZEN reviewed baseline: a backdated migration recorded after Increment 3a; revert it (never add it to the baseline)`
    : `${unknown.version}_${unknown.name} is not in the reviewed recovery baseline: refresh it from the target environment before applying Increment 3a`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sql = readText(RECOVERY_FILE);
  const regenerated = recoverySqlWithBaseline(sql, baselineVersions(RECOVERY_BASELINE));
  const digest = baselineDigest(RECOVERY_BASELINE.rows);
  if (process.argv[2] === "--write") {
    if (inc3aRecorded(STAGING_HISTORY.rows)) {
      console.log("REFUSED: Increment 3a is recorded in the current Staging history; the reviewed baseline is frozen");
      process.exit(1);
    }
    writeFileSync(RECOVERY_FILE, regenerated, "utf8");
    console.log(`recovery allowlist regenerated: ${recoveryBaselineInSql(regenerated).length} versions`);
    console.log(`set RECOVERY_BASELINE_SHA256 = "${digest}"`);
  } else if (process.argv[2] === "--check") {
    const allowlistOk = regenerated === sql;
    const integrity = baselineIntegrityViolation(RECOVERY_BASELINE);
    console.log(allowlistOk ? "recovery allowlist matches the reviewed baseline" : "recovery allowlist is STALE: run with --write");
    console.log(integrity ? `baseline integrity FAILED: ${integrity}` : "baseline integrity OK (pinned digest, ascending, below Increment 3a)");
    process.exit(allowlistOk && !integrity ? 0 : 1);
  } else {
    console.log("usage: node supabase/tests/email_marketing_v1_recovery_baseline.mjs --check | --write");
  }
}
