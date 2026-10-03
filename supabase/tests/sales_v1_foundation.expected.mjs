// Sales V1 Increment 1 - expected schema, written by hand from the approved
// architecture (docs/sales/ARCHITECTURE.md). It is NOT captured from a database:
// the integration suites compare the live catalog against this definition, so
// a drift in either direction fails.

export const MIGRATION_FILE = "20261002120000_sales_v1_foundation.sql";
export const MIGRATION_VERSION = "20261002120000";

const TZ = "timestamp with time zone";

export const TABLES = {
  "public.sales_audit_log": {
    columns: [
      ["id", "bigint", true],
      ["organization_id", "uuid", true],
      ["actor_user_id", "uuid", true],
      ["action", "text", true],
      ["entity_type", "text", true],
      ["entity_id", "uuid", true],
      ["details", "jsonb", true],
      ["created_at", TZ, true],
    ],
    checkConstraints: 4,
    keys: [
      { name: "sales_audit_log_pkey", type: "p", columns: ["id"] },
      { name: "sales_audit_log_organization_id_fkey", type: "f", columns: ["organization_id"], references: "public.organizations(id)" },
    ],
  },
  "public.sales_pipelines": {
    columns: [
      ["id", "uuid", true],
      ["organization_id", "uuid", true],
      ["name", "text", true],
      ["is_default", "boolean", true],
      ["status", "text", true],
      ["version", "bigint", true],
      ["structure_version", "bigint", true],
      ["created_by", "uuid", true],
      ["created_at", TZ, true],
      ["updated_at", TZ, true],
      ["archived_at", TZ, false],
      ["archived_by", "uuid", false],
    ],
    checkConstraints: 7,
    keys: [
      { name: "sales_pipelines_pkey", type: "p", columns: ["id"] },
      { name: "sales_pipelines_organization_id_id_key", type: "u", columns: ["organization_id", "id"] },
      { name: "sales_pipelines_organization_id_fkey", type: "f", columns: ["organization_id"], references: "public.organizations(id)" },
    ],
  },
  "public.sales_pipeline_stages": {
    columns: [
      ["id", "uuid", true],
      ["organization_id", "uuid", true],
      ["pipeline_id", "uuid", true],
      ["key", "text", true],
      ["name", "text", true],
      ["kind", "text", true],
      ["default_probability_bps", "integer", true],
      ["position", "integer", false],
      ["status", "text", true],
      ["version", "bigint", true],
      ["created_by", "uuid", true],
      ["created_at", TZ, true],
      ["updated_at", TZ, true],
      ["archived_at", TZ, false],
      ["archived_by", "uuid", false],
    ],
    checkConstraints: 10,
    keys: [
      { name: "sales_pipeline_stages_pkey", type: "p", columns: ["id"] },
      { name: "sales_pipeline_stages_organization_id_id_key", type: "u", columns: ["organization_id", "id"] },
      { name: "sales_pipeline_stages_pipeline_key_key", type: "u", columns: ["pipeline_id", "key"] },
      { name: "sales_pipeline_stages_pipeline_position_key", type: "u", columns: ["pipeline_id", "position"], deferrable: true, deferred: true },
      { name: "sales_pipeline_stages_pipeline_fkey", type: "f", columns: ["organization_id", "pipeline_id"], references: "public.sales_pipelines(organization_id, id)" },
    ],
  },
};

// Non-constraint indexes (constraint-backed indexes are covered by `keys`).
export const INDEXES = [
  { name: "sales_audit_log_org_created_idx", table: "public.sales_audit_log", unique: false, predicate: [] },
  { name: "sales_audit_log_entity_idx", table: "public.sales_audit_log", unique: false, predicate: [] },
  { name: "sales_pipelines_one_default_idx", table: "public.sales_pipelines", unique: true, predicate: ["is_default"] },
  { name: "sales_pipelines_active_name_idx", table: "public.sales_pipelines", unique: true, predicate: ["status", "'active'"] },
  { name: "sales_pipeline_stages_one_active_won_idx", table: "public.sales_pipeline_stages", unique: true, predicate: ["kind", "'won'", "status", "'active'"] },
  { name: "sales_pipeline_stages_active_name_idx", table: "public.sales_pipeline_stages", unique: true, predicate: ["status", "'active'"] },
  { name: "sales_pipeline_stages_org_pipeline_idx", table: "public.sales_pipeline_stages", unique: false, predicate: [] },
];

export const SEQUENCES = ["public.sales_audit_log_id_seq"];

// timing: BEFORE | AFTER; level: ROW | STATEMENT; events sorted alphabetically.
export const TRIGGERS = [
  { table: "public.sales_audit_log", name: "sales_audit_log_reject_mutation", timing: "BEFORE", level: "ROW", events: ["DELETE", "UPDATE"], columns: [], fn: "private.sales_reject_mutation()", constraint: false },
  { table: "public.sales_audit_log", name: "sales_audit_log_reject_truncate", timing: "BEFORE", level: "STATEMENT", events: ["TRUNCATE"], columns: [], fn: "private.sales_reject_mutation()", constraint: false },
  { table: "public.sales_pipelines", name: "sales_pipelines_reject_truncate", timing: "BEFORE", level: "STATEMENT", events: ["TRUNCATE"], columns: [], fn: "private.sales_reject_mutation()", constraint: false },
  { table: "public.sales_pipelines", name: "sales_pipelines_guard", timing: "BEFORE", level: "ROW", events: ["DELETE", "INSERT", "UPDATE"], columns: [], fn: "private.sales_pipelines_guard()", constraint: false },
  { table: "public.sales_pipelines", name: "sales_pipelines_check_structure", timing: "AFTER", level: "ROW", events: ["INSERT"], columns: [], fn: "private.sales_check_pipeline_structure()", constraint: true, deferrable: true, deferred: true },
  { table: "public.sales_pipeline_stages", name: "sales_pipeline_stages_reject_truncate", timing: "BEFORE", level: "STATEMENT", events: ["TRUNCATE"], columns: [], fn: "private.sales_reject_mutation()", constraint: false },
  { table: "public.sales_pipeline_stages", name: "sales_pipeline_stages_guard", timing: "BEFORE", level: "ROW", events: ["DELETE", "INSERT", "UPDATE"], columns: [], fn: "private.sales_pipeline_stages_guard()", constraint: false },
  { table: "public.sales_pipeline_stages", name: "sales_pipeline_stages_bump_structure", timing: "AFTER", level: "ROW", events: ["INSERT", "UPDATE"], columns: ["position", "status"], fn: "private.sales_bump_pipeline_structure()", constraint: false },
  { table: "public.sales_pipeline_stages", name: "sales_pipeline_stages_check_structure", timing: "AFTER", level: "ROW", events: ["INSERT", "UPDATE"], columns: [], fn: "private.sales_check_pipeline_structure()", constraint: true, deferrable: true, deferred: true },
];

export const POLICIES = [
  { table: "public.sales_audit_log", name: "sales_audit_log_select" },
  { table: "public.sales_pipelines", name: "sales_pipelines_select" },
  { table: "public.sales_pipeline_stages", name: "sales_pipeline_stages_select" },
].map((policy) => ({
  ...policy,
  command: "SELECT",
  roles: "authenticated",
  mustContain: ["current_user_organization_id()", "sales_can('read'::text)"],
}));

// volatility: s = stable, v = volatile, i = immutable.
// execute: API roles that must hold EXECUTE; every other API role and PUBLIC must not.
export const FUNCTIONS = [
  { sig: "private.sales_can(text)", secdef: true, volatility: "s", result: "boolean", execute: ["authenticated"] },
  { sig: "private.sales_require(text)", secdef: true, volatility: "s", result: "uuid", execute: [] },
  { sig: "private.sales_clean_name(text)", secdef: false, volatility: "i", result: "text", execute: [] },
  { sig: "private.sales_reject_mutation()", secdef: true, volatility: "v", result: "trigger", execute: [] },
  { sig: "private.sales_pipelines_guard()", secdef: true, volatility: "v", result: "trigger", execute: [] },
  { sig: "private.sales_pipeline_stages_guard()", secdef: true, volatility: "v", result: "trigger", execute: [] },
  { sig: "private.sales_bump_pipeline_structure()", secdef: true, volatility: "v", result: "trigger", execute: [] },
  { sig: "private.sales_check_pipeline_structure()", secdef: true, volatility: "v", result: "trigger", execute: [] },
  { sig: "private.sales_write_audit(uuid,text,text,uuid,jsonb)", secdef: true, volatility: "v", result: "void", execute: [] },
  { sig: "public.sales_ensure_default_pipeline()", secdef: true, volatility: "v", result: "jsonb", execute: ["authenticated"] },
  { sig: "public.sales_create_stage(uuid,text,text,text,integer)", secdef: true, volatility: "v", result: "public.sales_pipeline_stages", execute: ["authenticated"] },
  { sig: "public.sales_update_stage(uuid,jsonb,bigint)", secdef: true, volatility: "v", result: "public.sales_pipeline_stages", execute: ["authenticated"] },
  { sig: "public.sales_reorder_stages(uuid,uuid[])", secdef: true, volatility: "v", result: "SETOF public.sales_pipeline_stages", execute: ["authenticated"] },
  { sig: "public.sales_archive_stage(uuid)", secdef: true, volatility: "v", result: "public.sales_pipeline_stages", execute: ["authenticated"] },
];

// Every Sales function runs with an empty search_path and is owned by postgres.
export const FUNCTION_CONFIG = ['search_path=""'];
export const FUNCTION_OWNER = "postgres";

// Table privileges per API role. Anything not listed must be absent.
export const TABLE_PRIVILEGES = {
  anon: [],
  authenticated: ["SELECT"],
  service_role: [],
  PUBLIC: [],
};

export const CANONICAL_DEFAULT_PIPELINE = {
  name: "Pipeline principal",
  stages: [
    { key: "new", name: "Nuevo", kind: "open", probability: 1000, position: 1 },
    { key: "qualified", name: "Calificado", kind: "open", probability: 2500, position: 2 },
    { key: "proposal", name: "Propuesta", kind: "open", probability: 5000, position: 3 },
    { key: "negotiation", name: "Negociación", kind: "open", probability: 7500, position: 4 },
    { key: "won", name: "Ganado", kind: "won", probability: 10000, position: 5 },
    { key: "lost", name: "Perdido", kind: "lost", probability: 0, position: 6 },
  ],
};

export const ERROR_CODES = [
  "SALES_AUTH_REQUIRED",
  "SALES_NO_ACTIVE_ORGANIZATION",
  "SALES_FORBIDDEN",
  "SALES_INVALID_INPUT",
  "SALES_NOT_FOUND",
  "SALES_VERSION_CONFLICT",
  "SALES_STAGE_KEY_EXISTS",
  "SALES_STAGE_NAME_EXISTS",
  "SALES_WON_STAGE_EXISTS",
  "SALES_LAST_WON_STAGE",
  "SALES_LAST_LOST_STAGE",
  "SALES_STAGE_ARCHIVED",
  "SALES_INVALID_STAGE_SET",
  "SALES_STAGE_LIMIT",
  "SALES_TERMINAL_STAGE_INVARIANT",
  "SALES_STAGE_POSITION_INVARIANT",
  "SALES_IMMUTABLE",
  "SALES_RETRY",
];

// Identifiers owned by other workstreams that Increment 1 must not reference.
export const FORBIDDEN_REFERENCES = [
  "public.clients",
  "client_notes",
  "member_module_access",
  "has_active_module_access",
  "can_manage_organization",
  "is_platform_owner",
  "email_",
  "builder_",
  "goal_engine",
  "orb_",
  "projects",
  "discovery_",
];
