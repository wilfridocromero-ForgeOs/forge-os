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
| 2 | Leads and attribution touches | Implemented (not committed); see section 8 |
| 3 | Opportunities, stage history, lead conversion | Not started. The Staging `public.clients` inspection is done (customer/account identity; must not hold leads). The meaning of `clients.status = 'lead'` will be decided in Increment 3 conversion planning |
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

## 8. Increment 2 as built: Leads + Attribution

The migration is `supabase/migrations/20261003120000_sales_v1_leads_attribution.sql`. Approved decisions:

- **D1:** `private.sales_can` gains the action `manage_leads`. It stays founder/admin only, with no platform-owner bypass.
- **D2:** the audit log's `action` and `entity_type` CHECKs are widened additively, and a new `sales_audit_log_lead_entity_check` binds lead actions to the `lead`/`lead_touch` entity types.
- **D3:** the Increment 1 validator stays frozen. `supabase/tests/validate_sales_v1_leads.mjs` is the new cumulative validator.
- **D4:** the Increment 1 Staging runner reports BLOCKED once Increment 2 is applied. The Increment 2 rollback is valid only before real use; after that, recovery is a forward fix.

**Guard.** Before changing any Increment 1 object, the migration:

1. locks `sales_audit_log` in ACCESS EXCLUSIVE mode;
2. verifies that the `private.sales_can` body MD5 is `2f61c4f2f9c52c0ab2e7a19495652a33`, that it is SECURITY DEFINER with `search_path=""`, and that it is owned by `postgres`;
3. verifies that the 4 audit CHECKs are exactly the Increment 1 definitions.

Any difference raises `SALES_MIGRATION_DRIFT` and the whole migration rolls back.

### Model

| Object | Purpose |
|---|---|
| `sales_leads` | Organization-scoped intake record. Not the customer identity: `public.clients` is never written. A lead never implies marketing consent. |
| `sales_lead_touches` | Append-only attribution evidence. UPDATE, DELETE and TRUNCATE are rejected for every role, including the owner. `received_at` is set by the server. Touches link to their lead through the composite FK `(organization_id, lead_id)`. |
| `sales_lead_attribution` | Security-invoker view: first and last touch per lead, derived from the touches. Order: `occurred_at`, then `received_at`, then `id`. No first/last pointers are stored. |

### Identity

- **Minimum identity:** a normalized email, a normalized phone, or an `external_source` plus `external_id`. Name-only leads are rejected.
- **Email normalization:** `private.sales_normalize_email` uses the same rules as Email Marketing's normalizer: trim, lower-case, no dot or `+tag` stripping. Parity is proven by tests.
- **Phone normalization:** formatting only. A leading `+` is kept, 7-15 digits are required, and the country is never inferred.
- **Uniqueness and matching:**
  - At most one **active** lead (not archived) per normalized email, and per external key, within an organization. There's no deduplication across organizations.
  - Match order: external key, then email, then phone. Phone is used only when no email was supplied.
  - Archived leads are never matched, so a later inquiry creates a new lead.
- **Not in Increment 2:** a matched lead is not enriched with the submission's other identity fields. Use `sales_update_lead` for that.

### Lifecycle

| From | Allowed transitions |
|---|---|
| `new` | `qualified`, `disqualified` |
| `qualified` | `disqualified` |
| `disqualified` | `qualified` |
| `new`, `qualified`, `disqualified` | `archived` (terminal) |

- `converted` arrives with Increment 3. "Contacted" is not a state.
- Qualification and disqualification record a reason code, an optional note (up to 500 characters), the actor and a timestamp.
- Optimistic locking uses `version`, and a guard trigger enforces the transitions for every role.
- **Qualify reasons:** `fit`, `need`, `budget`, `timing`, `other`.
- **Disqualify reasons:** `no_fit`, `no_budget`, `unresponsive`, `duplicate`, `spam`, `other`.
- **Archive reasons:** `duplicate`, `spam`, `test`, `not_interested`, `other`.

### Attribution evidence

Each touch stores:

- `occurred_at` (claimed by the caller; from 2000 to at most 5 minutes in the future) and `received_at` (server time)
- `ingestion_channel`: `manual`, `import`, `api`. `landing_page` and `webhook` are reserved for a future trusted entry point.
- `channel`: a closed list, defaulting to `unknown`
- the five UTM fields, normalized (trimmed and lower-cased, up to 200 characters each)
- `referrer_url` and `landing_url`: http/https only, no userinfo, up to 2048 characters
- opaque `landing_asset_id`, `funnel_id` and `campaign_ref`, with no FK to Builder or Email
- allow-listed `click_ids`: `gclid`, `fbclid`, `msclkid`, `ttclid`, `li_fat_id`
- `event_source` plus `external_event_id`
- bounded `raw` evidence: a flat object of strings, at most 50 keys, 1,024 characters per value and 8 KB in total

**Cap:** at most 1,000 touches per lead. This is a CHECK on a counter maintained by a trigger, and the RPCs pre-check it to return `SALES_TOUCH_LIMIT`.

### Idempotency and concurrency

- **Idempotency:** an `idempotency_key` plus the SHA-256 of the canonical request, unique per organization. The same applies to `(event_source, external_event_id)`.
  - An exact replay returns the original lead and touch, with `replayed = true` and no new audit row.
  - The same key with a different payload raises `SALES_IDEMPOTENCY_CONFLICT`.
- **Concurrency:** ingestion, add-touch and identity updates take a per-organization transaction advisory lock, which serializes match-then-insert. Partial unique indexes are the backstop.

### RPCs

All RPCs are executable by `authenticated` only, require `manage_leads`, and never take an organization ID. IDs from another organization behave exactly like missing IDs (`SALES_NOT_FOUND`).

| RPC | Audit action |
|---|---|
| `sales_ingest_lead(p_lead, p_touch, p_idempotency_key)` | `sales.lead.created` for a new lead, or `sales.lead.touch_added` when it matches an existing one |
| `sales_add_lead_touch(p_lead_id, p_touch, p_idempotency_key)` | `sales.lead.touch_added` |
| `sales_update_lead(p_lead_id, p_changes, p_expected_version)`: email, phone, name and company only | `sales.lead.updated` (changed field **names** only) |
| `sales_qualify_lead` / `sales_disqualify_lead(p_lead_id, p_reason, p_note, p_expected_version)` | `sales.lead.qualified` / `.disqualified` |
| `sales_archive_lead(p_lead_id, p_reason, p_expected_version)` | `sales.lead.archived` (re-archiving is a no-op) |

- **Audit details hold no personal data.** They contain `has_email`, `has_phone` and `has_note` flags, the channel, the UTM source and campaign, field names and versions. They never contain an email, phone, name, company or note.
- Exactly one audit row per successful mutation. Failures and no-ops write none.

### Errors added in Increment 2

`SALES_MIGRATION_DRIFT`, `SALES_IDEMPOTENCY_CONFLICT`, `SALES_LEAD_ARCHIVED`, `SALES_INVALID_TRANSITION`, `SALES_TOUCH_LIMIT`, `SALES_LEAD_EMAIL_EXISTS`.

`SALES_INVALID_INPUT` puts the offending field name in `detail`, for example `lead.email` or `touch.raw`.

### Tests

| Layer | Command |
|---|---|
| Cumulative static validator | `node supabase/tests/validate_sales_v1_leads.mjs` |
| PGlite | `npx -y -p @electric-sql/pglite node supabase/tests/sales_v1_leads.integration.mjs` |
| Real PostgreSQL, with the Increment 1 regression | `SALES_PG_URL=... npx -y -p pg@8 node supabase/tests/sales_v1_leads.postgres.mjs` |
| Sabotage | `SALES_PG_URL=... npx -y -p pg@8 node supabase/tests/sales_v1_leads.sabotage.mjs` |

The Increment 1 regression runs the frozen Increment 1 suite on Increment 1 + Increment 2. Exactly two Increment 1 tests fail by design, both at the exact-inventory assertion: its catalog test and its rollback test.

### Rollback and recovery

`supabase/tests/rollback/sales_v1_leads_attribution_rollback.sql`:

- Takes ACCESS EXCLUSIVE locks first, on the audit log, leads and touches.
- Verifies the exact Increment 1 + Increment 2 inventory and the Increment 2 definitions.
- **Refuses, with no override,** if any lead, touch or lead audit row exists.
- Drops the Increment 2 objects without CASCADE.
- Restores `private.sales_can` and the audit CHECKs byte-exact to Increment 1, and deletes the `20261003120000` history row.
- Its postflight requires the exact Increment 1 state.

## 9. Forward fix M1: default-pipeline first-creation race

The fix is migration `supabase/migrations/20261002130000_sales_v1_default_pipeline_lock.sql`. It's a separate forward fix (D4), applied after Increment 1 and before Increment 2.

- **Defect (Increment 1):** concurrent first calls to `sales_ensure_default_pipeline` could make one caller collide on `sales_pipelines_active_name_idx`, because `ON CONFLICT` only arbitrates `sales_pipelines_one_default_idx`. That caller got a raw `23505` instead of the existing pipeline. Integrity was never affected: there was always exactly one default pipeline.
- **Fix:**
  - If no default pipeline is visible, take a per-organization transaction advisory lock (`orvesen.sales.pipelines:<org>`), re-check, and create only if it's still absent. Callers that find an existing pipeline take no lock.
  - Everything else is unchanged: signature, authorization, canonical stages, audit event, errors and grants.
  - The new body is the Increment 1 body plus this block, which the static validator proves.
- **Guard:** the replacement happens only if the current body MD5 is `12c3ea7d7a2c4f27dc67baab17104058` with the Increment 1 attributes. Otherwise `SALES_MIGRATION_DRIFT` aborts it. The new body MD5 is `71eabecb4cade2f2dd3ff651e8b18199`.
- **Tests:**
  - `node supabase/tests/validate_sales_v1_default_pipeline_lock.mjs`
  - `SALES_PG_URL=... npx -y -p pg@8 node supabase/tests/sales_v1_default_pipeline_lock.postgres.mjs [rounds]`. This covers the guard, the lock being used, at least 20 rounds of 8 simultaneous first calls, the frozen Increment 1 suite run 3 times, rollback/reapply, and the lock-removal sabotage.
- **Rollback:** `supabase/tests/rollback/sales_v1_default_pipeline_lock_rollback.sql` restores the Increment 1 body byte-exact. It is guarded by the fix's fingerprint, and it reintroduces the race, so it's for recovery only.
- **Staging:** the Increment 1 Staging runner reports BLOCKED once this fix is applied (history 79), as accepted under D4.
