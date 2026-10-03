// Sales V1 Increment 1 - real PostgreSQL run (authoritative layer for RLS,
// SECURITY DEFINER, GRANT/REVOKE and concurrent invariant enforcement).
//
// Requires a THROWAWAY local cluster. The suite creates cluster-wide roles
// (anon, authenticated, service_role) if missing and creates/drops its own
// databases named sales_v1_t_*. Never point it at a shared or remote server.
//
// Example (PostgreSQL 17 binaries, data directory outside the repository):
//   initdb -D <tmp>/pgdata -U postgres -A trust -E UTF8 --locale=C
//   pg_ctl -D <tmp>/pgdata -o "-p 55432 -c listen_addresses=localhost" -l <tmp>/pg.log start
//   SALES_PG_URL=postgres://postgres@localhost:55432/postgres \
//     npx -y -p pg@8 node supabase/tests/sales_v1_foundation.postgres.mjs
//   pg_ctl -D <tmp>/pgdata stop

import { postgresDriver, runSuite, summarize } from "./sales_v1_foundation.suite.mjs";

const url = process.env.SALES_PG_URL;
if (!url) {
  console.error("BLOCKED: SALES_PG_URL is not set (see header for a throwaway cluster).");
  process.exit(2);
}
const parsed = new URL(url);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)) {
  console.error(`BLOCKED: refusing non-local host ${parsed.hostname}.`);
  process.exit(2);
}
if ((parsed.port || "5432") === "5432" && process.env.SALES_PG_ALLOW_DEFAULT_PORT !== "1") {
  console.error("BLOCKED: refusing the default port 5432 (likely a shared server). Use a throwaway cluster.");
  process.exit(2);
}

const driver = await postgresDriver(url);
let counts;
try {
  const results = await runSuite({ driver, log: (line) => console.log(line) });
  counts = summarize(results);
} finally {
  await driver.close();
}
console.log(`\nPostgreSQL: ${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped`);
process.exit(counts.FAIL === 0 && counts.SKIP === 0 && counts.PASS > 0 ? 0 : 1);
