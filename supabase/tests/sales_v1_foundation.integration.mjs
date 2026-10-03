// Sales V1 Increment 1 - PGlite integration run (in-process PostgreSQL).
//
// PGlite is intentionally not a project dependency. Run with an ephemeral npx:
//   npx -y -p @electric-sql/pglite node supabase/tests/sales_v1_foundation.integration.mjs
//
// PGlite is a single connection: concurrency tests are SKIPPED here and run in
// sales_v1_foundation.postgres.mjs. PGlite alone is not final proof for RLS,
// SECURITY DEFINER, grants or concurrent invariants.

import { pgliteDriver, runSuite, summarize } from "./sales_v1_foundation.suite.mjs";

const driver = await pgliteDriver();
const results = await runSuite({ driver, log: (line) => console.log(line) });
const counts = summarize(results);
console.log(`\nPGlite: ${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped (concurrency requires real PostgreSQL)`);
process.exit(counts.FAIL === 0 && counts.PASS > 0 ? 0 : 1);
