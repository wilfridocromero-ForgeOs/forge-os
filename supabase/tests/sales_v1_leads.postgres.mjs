// Sales V1 Increment 2 - real PostgreSQL run (authoritative layer for RLS,
// SECURITY DEFINER, GRANT/REVOKE and concurrency), plus the Increment 1
// regression on the cumulative schema.
//
// Requires a THROWAWAY local cluster (see sales_v1_foundation.postgres.mjs):
//   SALES_PG_URL=postgres://postgres@localhost:55432/postgres \
//     npx -y -p pg@8 node supabase/tests/sales_v1_leads.postgres.mjs
//
// Increment 1 regression: the frozen Increment 1 suite runs against
// Increment 1 + Increment 2. Exactly two Increment 1 tests are expected to fail
// by design (approved decisions D3/D4): its exact inventory test (Increment 2
// adds objects and changes sales_can) and its rollback test (the Increment 1
// rollback correctly refuses to run while Increment 2 objects exist).

import {
  postgresDriver, runSuite as runInc1Suite, summarize as summarizeInc1, TEST_NAMES as INC1_TEST_NAMES,
} from "./sales_v1_foundation.suite.mjs";
import { readFixMigration, readInc1Migration, readMigration, runSuite, summarize } from "./sales_v1_leads.suite.mjs";

export const INC1_EXPECTED_FAILURES = [
  "catalog: inventory, columns, keys, triggers, policies, functions match the hand-written spec",
  "rollback: apply, verify, blocked cases, rollback, zero objects, reapply, verify",
];

const url = process.env.SALES_PG_URL;
if (!url) {
  console.error("BLOCKED: SALES_PG_URL is not set.");
  process.exit(2);
}
const parsed = new URL(url);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname) || (parsed.port || "5432") === "5432") {
  console.error("BLOCKED: use a throwaway local cluster on a non-default port.");
  process.exit(2);
}

const driver = await postgresDriver(url);
let ok = true;
try {
  const results = await runSuite({ driver, log: (line) => console.log(line) });
  const counts = summarize(results);
  console.log(`\nPostgreSQL (Inc2): ${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped`);
  ok = counts.FAIL === 0 && counts.SKIP === 0 && counts.PASS > 0;

  console.log("\nIncrement 1 regression on the cumulative schema (Inc1 + Inc2):");
  for (const name of INC1_EXPECTED_FAILURES) {
    if (!INC1_TEST_NAMES.includes(name)) throw new Error(`unknown Inc1 test: ${name}`);
  }
  const inc1 = await runInc1Suite({ driver, migrationSql: `${readInc1Migration()}\n;\n${readFixMigration()}\n;\n${readMigration()}` });
  const failed = inc1.filter((result) => result.status === "FAIL").map((result) => result.name).sort();
  const inc1Counts = summarizeInc1(inc1);
  for (const result of inc1) {
    const expectedFail = INC1_EXPECTED_FAILURES.includes(result.name);
    console.log(`${result.status === "PASS" ? "PASS" : expectedFail ? "XFAIL" : "FAIL"}  ${result.name}`);
  }
  const regressionOk = JSON.stringify(failed) === JSON.stringify([...INC1_EXPECTED_FAILURES].sort()) && inc1Counts.SKIP === 0;
  console.log(`Inc1 regression: ${inc1Counts.PASS} passed, ${failed.length} failed (expected exactly ${INC1_EXPECTED_FAILURES.length} by design): ${regressionOk ? "OK" : "UNEXPECTED"}`);
  ok = ok && regressionOk;
} finally {
  await driver.close();
}
process.exit(ok ? 0 : 1);
