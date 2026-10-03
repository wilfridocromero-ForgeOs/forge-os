# ORVESEN Sales V1: Architecture

Branch: `claude/sales-v1`. This workstream owns Sales only.

Each increment needs its own explicit authorization. This file records the approved V1 design and what has been built in each increment.

## 1. Principles

1. **One account identity.** `public.clients` is the account. Sales never creates a parallel customer table.
2. **A lead is intake evidence, not an identity.** A lead is converted into a client plus an opportunity (Increments 2 and 3).
3. **"Customer" is derived.** A customer is a client with at least one booked order (Increment 5).
4. **Sales never reads or writes `clients.status`.**
5. **Every row belongs to exactly one organization.** Sales-to-Sales references use composite keys `(organization_id, id)`.
6. **Writes go only through SECURITY DEFINER RPCs.** Each RPC authorizes through `private.sales_require(action)`. API roles have no direct DML.
7. **Invariants live in the database:** constraints, partial unique indexes, guard triggers and commit-time constraint triggers. They never depend on caller discipline.
8. **Money and tax** (from Increment 4):
   - Amounts are `bigint` minor units, with currency `USD` in V1.
   - Rates are integer ppm.
   - Rounding is half-up, done in one function.
   - IVU is stored as a per-component breakdown.
   - Financial documents are immutable once issued.
9. **No platform-owner bypass** applies to Sales data.

## 2. Increment roadmap

| Inc | Scope | Status |
|---|---|---|
| 1 | Authorization decision point, append-only audit log, pipelines and stages | Committed (`8394c45`); applied to Staging; Staging acceptance PASS 60/60 (see section 7) |
| 2 | Leads and attribution touches | Not started |
| 3 | Opportunities, stage history, lead conversion | Not started; needs read-only introspection of Staging `public.clients` first |
| 4 | Catalog, price versions, IVU rate sets, offers | Not started; IVU rules need validation by a PR tax professional |
| 5 | Orders, payments, receipts | Not started |
| 6 | Subscriptions and the MRR/churn ledger | Not started |
| 7 | Metrics and Orb-readable context | Not started; the Orb integration needs a shared contract |
| 8 | UI | Not started; needs App.jsx/Sidebar coordination |

## 3. Increment 1 as built

The migration is `supabase/migrations/20261002120000_sales_v1_foundation.sql`. It creates only new objects and modifies nothing that already exists.

### Authorization

| Function | Contract |
|---|---|
| `private.sales_can(action)` | The only decision point. Actions are `read` and `manage_pipeline`. It returns true only for `founder` or `admin` of the caller's **active** organization. Unknown or null actions return `false`. It reads `organization_memberships` directly, so a future cross-tenant bypass added to a shared helper is never inherited. |
| `private.sales_require(action)` | Returns the active organization, or raises `SALES_AUTH_REQUIRED`, `SALES_NO_ACTIVE_ORGANIZATION` or `SALES_FORBIDDEN` (SQLSTATE `42501`). |

Increment 1 does not depend on `member_module_access`, `can_manage_organization` or `is_platform_owner`. Extending Sales to `area_lead`/`member` requires the shared module-access contract owned by Codex.

### Tables

| Table | Purpose | Lifecycle |
|---|---|---|
| `sales_audit_log` | One row per successful mutation. | Append-only. UPDATE, DELETE and TRUNCATE are rejected by triggers for **every** role, including the owner. |
| `sales_pipelines` | Pipelines per organization. At most one `is_default` per organization (partial unique index). | Created `active`. Can only move to `archived`, never back. Never deleted. `version` counts content changes. `structure_version` counts stage-structure changes. |
| `sales_pipeline_stages` | Ordered stages. `kind ∈ {open, won, lost}`. `key` is an immutable slug that is unique per pipeline forever. | Created `active`. Can only move to `archived`, never back. Never deleted. Active stages have positions `1..n`; archived stages have `position = null`. `version` is derived by the guard trigger. |

### Invariants and how each is enforced

| Invariant | Enforcement |
|---|---|
| At most one active won stage per pipeline | Partial unique index `sales_pipeline_stages_one_active_won_idx` (immediate) |
| Exactly one active won stage and at least one active lost stage per active pipeline | Deferred constraint triggers `sales_pipeline_stages_check_structure` and `sales_pipelines_check_structure` (checked at commit) |
| Active positions are contiguous `1..n`, with `n ≤ 50` | The same deferred check, plus the deferrable unique constraint `(pipeline_id, position)` |
| Concurrent structural changes cannot bypass the commit-time check | Every stage insert and every status/position change updates the parent pipeline row (`sales_pipeline_stages_bump_structure`), which serializes them per pipeline. Under READ COMMITTED the later transaction waits, and its commit check sees the earlier commit. Under REPEATABLE READ or SERIALIZABLE it fails with `40001`. |
| Identity columns (`id`, `organization_id`, `pipeline_id`, `key`, `kind`, `created_*`, `is_default`) cannot change | Guard triggers (`SALES_IMMUTABLE`) |
| `version` cannot be rewound or frozen by a caller | The guard trigger always derives it |
| Cross-organization references are impossible | Composite FK `(organization_id, pipeline_id)`; every RPC filters by the caller's organization |
| One default pipeline per organization, even under concurrent first calls | Partial unique index plus `INSERT … ON CONFLICT DO NOTHING` in `sales_ensure_default_pipeline` |

The RPCs also check the terminal-stage rules up front (`SALES_LAST_WON_STAGE`, `SALES_LAST_LOST_STAGE`, `SALES_WON_STAGE_EXISTS`) to return friendly errors. The database layers above remain authoritative.

### RPCs

All RPCs can be executed by `authenticated` only. Each requires `manage_pipeline` and writes exactly one audit row when it changes something. A no-op writes nothing, and a failure leaves nothing behind.

| RPC | Behaviour | Audit action |
|---|---|---|
| `sales_ensure_default_pipeline()` | Idempotent and concurrency-safe. Creates "Pipeline principal" with `new, qualified, proposal, negotiation, won, lost`, or returns the existing pipeline. Returns `{was_created, pipeline, stages}`. | `sales.pipeline.created` |
| `sales_create_stage(pipeline_id, key, name, kind, probability_bps)` | Appends at the end. Keys stay reserved after archive. Names are unique among active stages (case-insensitive). | `sales.stage.created` |
| `sales_update_stage(stage_id, changes jsonb, expected_version)` | Patch keys are `name` and `default_probability_bps` only. A stale version raises `SALES_VERSION_CONFLICT`. A no-op returns the row without a version bump or audit row. | `sales.stage.updated` |
| `sales_reorder_stages(pipeline_id, stage_ids uuid[])` | The array must be exactly the complete set of active stage IDs: no missing, duplicate, foreign, archived or null IDs. An identical order is a no-op. | `sales.stages.reordered` |
| `sales_archive_stage(stage_id)` | Refuses the won stage and the last lost stage. Compacts the remaining positions. Re-archiving is a no-op. | `sales.stage.archived` |

### Errors

These are stable codes in the error `message`:

- `SALES_AUTH_REQUIRED`, `SALES_NO_ACTIVE_ORGANIZATION`, `SALES_FORBIDDEN`
- `SALES_INVALID_INPUT`, `SALES_NOT_FOUND`, `SALES_VERSION_CONFLICT`
- `SALES_STAGE_KEY_EXISTS`, `SALES_STAGE_NAME_EXISTS`, `SALES_WON_STAGE_EXISTS`, `SALES_STAGE_LIMIT`
- `SALES_LAST_WON_STAGE`, `SALES_LAST_LOST_STAGE`, `SALES_STAGE_ARCHIVED`, `SALES_INVALID_STAGE_SET`
- `SALES_TERMINAL_STAGE_INVARIANT`, `SALES_STAGE_POSITION_INVARIANT`, `SALES_IMMUTABLE`
- `SALES_RETRY`: a defensive code that should never occur.

Rows from another organization report `SALES_NOT_FOUND`, never `SALES_FORBIDDEN`, so their existence is not revealed.

### Grants

- **Tables:** all privileges are revoked from `PUBLIC`, `anon`, `authenticated` and `service_role`. Only `SELECT` is granted, and only to `authenticated`, filtered by RLS (active organization plus `sales_can('read')`).
- **Audit sequence:** no grants.
- **`service_role`:** has no access in Increment 1.
- **Functions:**
  - All are owned by `postgres`, set `search_path = ''`, and have EXECUTE revoked from everyone.
  - The five RPCs grant EXECUTE to `authenticated`.
  - `private.sales_can` also grants EXECUTE to `authenticated`, because RLS policies need it. It only reveals the caller's own permission.

## 4. Tests

None of these tools are project dependencies. They load through ephemeral `npx`.

| Layer | Command | Scope |
|---|---|---|
| Static | `node supabase/tests/validate_sales_v1_foundation.mjs` | Migration and rollback text against the hand-written spec and safety rules; git drift |
| PGlite | `npx -y -p @electric-sql/pglite node supabase/tests/sales_v1_foundation.integration.mjs` | Every non-concurrency test |
| Real PostgreSQL | `SALES_PG_URL=postgres://postgres@localhost:55432/postgres npx -y -p pg@8 node supabase/tests/sales_v1_foundation.postgres.mjs` | Every test, including adversarial concurrency |
| Sabotage | `SALES_PG_URL=… npx -y -p pg@8 node supabase/tests/sales_v1_foundation.sabotage.mjs` | Each protection is removed in an in-memory copy, and the suite must fail |
| Staging acceptance | `supabase/tests/sales_v1_foundation.staging_acceptance.sql`, run manually in the Staging SQL Editor | Functional acceptance against the real Staging database (see section 7) |

- **The expected schema is written by hand from this design** in `supabase/tests/sales_v1_foundation.expected.mjs`. It is never captured from a database.
- **The real-PostgreSQL runner refuses** non-local hosts and the default port 5432. Use a throwaway cluster:
  - `initdb -U postgres -A trust`
  - `pg_ctl … -o "-p 55432 -c listen_addresses=localhost"`

## 5. Rollback and recovery

`supabase/tests/rollback/sales_v1_foundation_rollback.sql` is for manual recovery only.

**It changes nothing if any of these is true:**

- the inventory differs from Increment 1 (missing or unexpected `sales_*` objects in any schema);
- any Sales table contains rows and `orvesen.sales_rollback_confirm = 'DESTROY_SALES_V1_INC1_DATA'` was not set in the same transaction;
- anything outside Sales depends on a Sales object (the script uses no CASCADE);
- any `sales_*` object remains after the drops.

**When it runs,** it also deletes the `20261002120000` row from `supabase_migrations.schema_migrations`, if that table exists.

## 6. Staging application notes

These follow the procedures learned during Email Marketing V1:

- The SQL Editor runs the whole file as one implicit transaction, and so does the Supabase CLI.
- Copy files using UTF-8 explicitly. The SQL files are ASCII-only.
- MD5 checks must strip `\r`.
- Never apply to production without separate authorization.

## 7. Staging acceptance record

Increment 1 was applied to Orvesen Staging (`vkvaispeujpsvotojyvz`) and verified there.

- **Apply:** the migration and its history row were recorded in a single SQL Editor transaction.
  - History row `20261002120000` / `sales_v1_foundation`; its MD5 (with `\r` stripped) is `ef72b4f0727cfa6053d2eb8efafd3247`.
  - The history count went from 77 to 78.
- **Postflight:** PASS with no failures. The catalog outside Sales was unchanged by the apply: digest `397521f96e0ca6dd75758ed23671176f`, 3877 items, the same before and after.
- **Functional acceptance:** `supabase/tests/sales_v1_foundation.staging_acceptance.sql`
  - The committed file is byte-identical to the runner that passed. SHA256 `c597ae2927713d33c1f751660a5ed6df4976f87608bcdb0c0ae1dd1eeaa7e240`.
  - Run ID `20261003t035401-418008`: **PASS, 60/60 checks.**
  - Production contacted: **NO**.
  - Synthetic writes committed: **NONE.**
  - After the run, migration history is still 78 and the Sales function fingerprint is `f0caa24672351afd7788dbb756f56c78`.
- **How the runner works:**
  - An environment guard runs first. If the database is not the approved post-apply Staging state, the runner reports BLOCKED and writes nothing.
  - Synthetic users, organizations and Sales rows run inside a savepoint that always ends by raising a sentinel, so they are always rolled back.
  - Product calls run as an impersonated `authenticated` user through the public RPCs.
  - Commit-time invariants are checked with `SET CONSTRAINTS ALL IMMEDIATE` checkpoints.
- **Caveats:**
  - **Identity sequence:** values of `sales_audit_log_id_seq` consumed during a run are not returned by the rollback. That is how PostgreSQL sequences behave. Audit IDs may therefore have gaps; no rows persist.
  - **Constants:** the runner hard-codes the post-apply catalog digest and history count. Once Staging changes (another migration, or real Sales rows), it reports BLOCKED and must be updated in a later increment rather than edited in place.
  - **Concurrency:** the SQL Editor uses a single connection, so concurrency is proven by the local real-PostgreSQL suite, not by this runner.
