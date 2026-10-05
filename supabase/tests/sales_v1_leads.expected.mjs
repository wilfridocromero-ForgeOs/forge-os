// Sales V1 Increment 2 - expected cumulative schema (Increment 1 + Increment 2),
// written by hand from the approved architecture (docs/sales/ARCHITECTURE.md).
// It is NOT captured from a database. The Increment 1 spec is imported
// unchanged and extended here.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as INC1 from "./sales_v1_foundation.expected.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export const INC1_MIGRATION_FILE = INC1.MIGRATION_FILE;
// Forward fix M1 for Increment 1 (applied between Increment 1 and Increment 2).
export const FIX_MIGRATION_FILE = "20261002130000_sales_v1_default_pipeline_lock.sql";
export const FIX_FILES = [
  `supabase/migrations/${FIX_MIGRATION_FILE}`,
  "supabase/tests/rollback/sales_v1_default_pipeline_lock_rollback.sql",
  "supabase/tests/sales_v1_default_pipeline_lock.postgres.mjs",
  "supabase/tests/validate_sales_v1_default_pipeline_lock.mjs",
];
export const MIGRATION_FILE = "20261003120000_sales_v1_leads_attribution.sql";
export const MIGRATION_VERSION = "20261003120000";
export const MIGRATION_NAME = "sales_v1_leads_attribution";

const TZ = "timestamp with time zone";

// Increment 1 fingerprints that the Increment 2 migration guards on and that
// the Increment 2 rollback restores.
export const INC1_SALES_CAN_MD5 = "2f61c4f2f9c52c0ab2e7a19495652a33";
export const INC1_AUDIT_CONSTRAINTS = [
  "sales_audit_log_action_check => CHECK ((action = ANY (ARRAY['sales.pipeline.created'::text, 'sales.stage.created'::text, 'sales.stage.updated'::text, 'sales.stage.archived'::text, 'sales.stages.reordered'::text])))",
  "sales_audit_log_check => CHECK (((entity_type = 'pipeline'::text) = (action = ANY (ARRAY['sales.pipeline.created'::text, 'sales.stages.reordered'::text]))))",
  "sales_audit_log_details_check => CHECK (((jsonb_typeof(details) = 'object'::text) AND (pg_column_size(details) <= 16384)))",
  "sales_audit_log_entity_type_check => CHECK ((entity_type = ANY (ARRAY['pipeline'::text, 'stage'::text])))",
];

export const AUDIT_ACTIONS = [
  "sales.pipeline.created", "sales.stage.created", "sales.stage.updated", "sales.stage.archived", "sales.stages.reordered",
  "sales.lead.created", "sales.lead.updated", "sales.lead.qualified", "sales.lead.disqualified", "sales.lead.archived",
  "sales.lead.touch_added",
];
export const INC2_AUDIT_CONSTRAINTS = [
  `sales_audit_log_action_check => CHECK ((action = ANY (ARRAY[${AUDIT_ACTIONS.map((a) => `'${a}'::text`).join(", ")}])))`,
  INC1_AUDIT_CONSTRAINTS[1],
  INC1_AUDIT_CONSTRAINTS[2],
  "sales_audit_log_entity_type_check => CHECK ((entity_type = ANY (ARRAY['pipeline'::text, 'stage'::text, 'lead'::text, 'lead_touch'::text])))",
  "sales_audit_log_lead_entity_check => CHECK ((((action = ANY (ARRAY['sales.lead.created'::text, 'sales.lead.updated'::text, 'sales.lead.qualified'::text, 'sales.lead.disqualified'::text, 'sales.lead.archived'::text])) = (entity_type = 'lead'::text)) AND ((action = 'sales.lead.touch_added'::text) = (entity_type = 'lead_touch'::text))))",
].sort();

// md5 of a function body as PostgreSQL stores it (prosrc = text between the
// dollar quotes), derived from the canonical migration source.
export function bodyMd5(migrationText, signatureStart) {
  const text = migrationText.replace(/\r\n/g, "\n");
  const start = text.indexOf(signatureStart);
  if (start < 0) throw new Error(`function not found: ${signatureStart}`);
  const open = text.indexOf("as $$", start) + "as $$".length;
  const close = text.indexOf("$$;", open);
  return createHash("md5").update(text.slice(open, close)).digest("hex");
}
export const INC2_SALES_CAN_MD5 = bodyMd5(
  readFileSync(resolve(here, "../migrations", MIGRATION_FILE), "utf8"),
  "create or replace function private.sales_can(requested_action text)");

export const TABLES = {
  ...INC1.TABLES,
  "public.sales_leads": {
    columns: [
      ["id", "uuid", true],
      ["organization_id", "uuid", true],
      ["email", "text", false],
      ["email_normalized", "text", false],
      ["phone", "text", false],
      ["phone_normalized", "text", false],
      ["full_name", "text", false],
      ["company_name", "text", false],
      ["external_source", "text", false],
      ["external_id", "text", false],
      ["status", "text", true],
      ["qualification_reason", "text", false],
      ["qualification_note", "text", false],
      ["qualification_decided_at", TZ, false],
      ["qualification_decided_by", "uuid", false],
      ["archive_reason", "text", false],
      ["archived_at", TZ, false],
      ["archived_by", "uuid", false],
      ["touch_count", "integer", true],
      ["created_via", "text", true],
      ["actor_type", "text", true],
      ["created_by", "uuid", false],
      ["version", "bigint", true],
      ["created_at", TZ, true],
      ["updated_at", TZ, true],
    ],
    checkConstraints: 23,
    keys: [
      { name: "sales_leads_pkey", type: "p", columns: ["id"] },
      { name: "sales_leads_organization_id_id_key", type: "u", columns: ["organization_id", "id"] },
      { name: "sales_leads_organization_id_fkey", type: "f", columns: ["organization_id"], references: "public.organizations(id)" },
    ],
  },
  "public.sales_lead_touches": {
    columns: [
      ["id", "uuid", true],
      ["organization_id", "uuid", true],
      ["lead_id", "uuid", true],
      ["occurred_at", TZ, true],
      ["received_at", TZ, true],
      ["ingestion_channel", "text", true],
      ["channel", "text", true],
      ["utm_source", "text", false],
      ["utm_medium", "text", false],
      ["utm_campaign", "text", false],
      ["utm_term", "text", false],
      ["utm_content", "text", false],
      ["referrer_url", "text", false],
      ["landing_url", "text", false],
      ["landing_asset_id", "uuid", false],
      ["funnel_id", "uuid", false],
      ["campaign_ref", "text", false],
      ["click_ids", "jsonb", true],
      ["event_source", "text", false],
      ["external_event_id", "text", false],
      ["raw", "jsonb", true],
      ["idempotency_key", "text", false],
      ["request_hash", "text", true],
      ["actor_type", "text", true],
      ["created_by", "uuid", false],
    ],
    checkConstraints: 20,
    keys: [
      { name: "sales_lead_touches_pkey", type: "p", columns: ["id"] },
      { name: "sales_lead_touches_organization_id_id_key", type: "u", columns: ["organization_id", "id"] },
      { name: "sales_lead_touches_lead_fkey", type: "f", columns: ["organization_id", "lead_id"], references: "public.sales_leads(organization_id, id)" },
    ],
  },
};
// The audit log gains one CHECK (sales_audit_log_lead_entity_check).
TABLES["public.sales_audit_log"] = { ...INC1.TABLES["public.sales_audit_log"], checkConstraints: 5 };

export const VIEWS = ["public.sales_lead_attribution"];

export const INDEXES = [
  ...INC1.INDEXES,
  { name: "sales_leads_active_email_idx", table: "public.sales_leads", unique: true, predicate: ["email_normalized IS NOT NULL", "status <> 'archived'"] },
  { name: "sales_leads_active_external_idx", table: "public.sales_leads", unique: true, predicate: ["external_id IS NOT NULL", "status <> 'archived'"] },
  { name: "sales_leads_active_phone_idx", table: "public.sales_leads", unique: false, predicate: ["phone_normalized IS NOT NULL", "status <> 'archived'"] },
  { name: "sales_leads_org_status_idx", table: "public.sales_leads", unique: false, predicate: [] },
  { name: "sales_lead_touches_idempotency_idx", table: "public.sales_lead_touches", unique: true, predicate: ["idempotency_key IS NOT NULL"] },
  { name: "sales_lead_touches_event_idx", table: "public.sales_lead_touches", unique: true, predicate: ["external_event_id IS NOT NULL"] },
  { name: "sales_lead_touches_lead_order_idx", table: "public.sales_lead_touches", unique: false, predicate: [] },
  { name: "sales_lead_touches_campaign_idx", table: "public.sales_lead_touches", unique: false, predicate: ["utm_campaign IS NOT NULL"] },
];

export const SEQUENCES = [...INC1.SEQUENCES];

export const TRIGGERS = [
  ...INC1.TRIGGERS,
  { table: "public.sales_leads", name: "sales_leads_guard", timing: "BEFORE", level: "ROW", events: ["DELETE", "INSERT", "UPDATE"], columns: [], fn: "private.sales_leads_guard()", constraint: false },
  { table: "public.sales_leads", name: "sales_leads_reject_truncate", timing: "BEFORE", level: "STATEMENT", events: ["TRUNCATE"], columns: [], fn: "private.sales_reject_mutation()", constraint: false },
  { table: "public.sales_lead_touches", name: "sales_lead_touches_guard", timing: "BEFORE", level: "ROW", events: ["DELETE", "INSERT", "UPDATE"], columns: [], fn: "private.sales_lead_touches_guard()", constraint: false },
  { table: "public.sales_lead_touches", name: "sales_lead_touches_reject_truncate", timing: "BEFORE", level: "STATEMENT", events: ["TRUNCATE"], columns: [], fn: "private.sales_reject_mutation()", constraint: false },
  { table: "public.sales_lead_touches", name: "sales_lead_touches_count", timing: "AFTER", level: "ROW", events: ["INSERT"], columns: [], fn: "private.sales_lead_touches_count()", constraint: false },
];

export const POLICIES = [
  ...INC1.POLICIES,
  ...[
    { table: "public.sales_leads", name: "sales_leads_select" },
    { table: "public.sales_lead_touches", name: "sales_lead_touches_select" },
  ].map((policy) => ({
    ...policy,
    command: "SELECT",
    roles: "authenticated",
    mustContain: ["current_user_organization_id()", "sales_can('read'::text)"],
  })),
];

const INC2_FUNCTIONS = [
  { sig: "private.sales_normalize_email(text)", secdef: false, volatility: "i", result: "text", execute: [] },
  { sig: "private.sales_normalize_phone(text)", secdef: false, volatility: "i", result: "text", execute: [] },
  { sig: "private.sales_clean_text(text,integer)", secdef: false, volatility: "i", result: "text", execute: [] },
  { sig: "private.sales_clean_url(text)", secdef: false, volatility: "i", result: "text", execute: [] },
  { sig: "private.sales_click_ids_valid(jsonb)", secdef: false, volatility: "i", result: "boolean", execute: [] },
  { sig: "private.sales_raw_valid(jsonb)", secdef: false, volatility: "i", result: "boolean", execute: [] },
  { sig: "private.sales_request_hash(jsonb)", secdef: false, volatility: "i", result: "text", execute: [] },
  { sig: "private.sales_leads_guard()", secdef: true, volatility: "v", result: "trigger", execute: [] },
  { sig: "private.sales_lead_touches_guard()", secdef: true, volatility: "v", result: "trigger", execute: [] },
  { sig: "private.sales_lead_touches_count()", secdef: true, volatility: "v", result: "trigger", execute: [] },
  { sig: "private.sales_clean_lead(jsonb)", secdef: false, volatility: "i", result: "jsonb", execute: [] },
  { sig: "private.sales_clean_touch(jsonb,text[])", secdef: false, volatility: "s", result: "jsonb", execute: [] },
  { sig: "private.sales_lead_result(uuid,boolean)", secdef: true, volatility: "s", result: "jsonb", execute: [] },
  { sig: "private.sales_find_replay(uuid,text,text,text,text)", secdef: true, volatility: "s", result: "uuid", execute: [] },
  { sig: "private.sales_lock_organization_leads(uuid)", secdef: true, volatility: "v", result: "void", execute: [] },
  { sig: "private.sales_insert_touch(uuid,uuid,jsonb,text,text)", secdef: true, volatility: "v", result: "public.sales_lead_touches", execute: [] },
  { sig: "private.sales_ingest_lead_core(uuid,jsonb,jsonb,text,text[])", secdef: true, volatility: "v", result: "jsonb", execute: [] },
  { sig: "private.sales_transition_lead(uuid,uuid,text,text,text,bigint)", secdef: true, volatility: "v", result: "public.sales_leads", execute: [] },
  { sig: "public.sales_ingest_lead(jsonb,jsonb,text)", secdef: true, volatility: "v", result: "jsonb", execute: ["authenticated"] },
  { sig: "public.sales_add_lead_touch(uuid,jsonb,text)", secdef: true, volatility: "v", result: "jsonb", execute: ["authenticated"] },
  { sig: "public.sales_update_lead(uuid,jsonb,bigint)", secdef: true, volatility: "v", result: "public.sales_leads", execute: ["authenticated"] },
  { sig: "public.sales_qualify_lead(uuid,text,text,bigint)", secdef: true, volatility: "v", result: "public.sales_leads", execute: ["authenticated"] },
  { sig: "public.sales_disqualify_lead(uuid,text,text,bigint)", secdef: true, volatility: "v", result: "public.sales_leads", execute: ["authenticated"] },
  { sig: "public.sales_archive_lead(uuid,text,bigint)", secdef: true, volatility: "v", result: "public.sales_leads", execute: ["authenticated"] },
];
export const INC2_FUNCTION_SIGNATURES = INC2_FUNCTIONS.map((fn) => fn.sig);
export const FUNCTIONS = [...INC1.FUNCTIONS, ...INC2_FUNCTIONS];
export const FUNCTION_CONFIG = INC1.FUNCTION_CONFIG;
export const FUNCTION_OWNER = INC1.FUNCTION_OWNER;

// Privileges on the new tables and on the view (same model as Increment 1).
export const TABLE_PRIVILEGES = INC1.TABLE_PRIVILEGES;

export const INC2_RELATIONS = [
  "public.sales_lead_attribution:v",
  "public.sales_lead_touches:r",
  "public.sales_lead_touches_campaign_idx:i",
  "public.sales_lead_touches_event_idx:i",
  "public.sales_lead_touches_idempotency_idx:i",
  "public.sales_lead_touches_lead_order_idx:i",
  "public.sales_lead_touches_organization_id_id_key:i",
  "public.sales_lead_touches_pkey:i",
  "public.sales_leads:r",
  "public.sales_leads_active_email_idx:i",
  "public.sales_leads_active_external_idx:i",
  "public.sales_leads_active_phone_idx:i",
  "public.sales_leads_org_status_idx:i",
  "public.sales_leads_organization_id_id_key:i",
  "public.sales_leads_pkey:i",
];

export const INC2_ERROR_CODES = [
  "SALES_MIGRATION_DRIFT",
  "SALES_IDEMPOTENCY_CONFLICT",
  "SALES_LEAD_ARCHIVED",
  "SALES_INVALID_TRANSITION",
  "SALES_TOUCH_LIMIT",
  "SALES_LEAD_EMAIL_EXISTS",
  "SALES_INVALID_INPUT",
  "SALES_NOT_FOUND",
  "SALES_VERSION_CONFLICT",
  "SALES_AUTH_REQUIRED",
  "SALES_IMMUTABLE",
];

export const QUALIFY_REASONS = ["fit", "need", "budget", "timing", "other"];
export const DISQUALIFY_REASONS = ["no_fit", "no_budget", "unresponsive", "duplicate", "spam", "other"];
export const ARCHIVE_REASONS = ["duplicate", "spam", "test", "not_interested", "other"];
export const CHANNELS = ["direct", "organic_search", "paid_search", "organic_social", "paid_social", "email",
  "referral", "affiliate", "display", "offline", "other", "unknown"];
export const CLICK_ID_KEYS = ["gclid", "fbclid", "msclkid", "ttclid", "li_fat_id"];

// Increment 1 artifacts that must remain byte-identical (sha256 of content with
// CRLF normalized to LF), as committed in 8394c45 / 6a49fbc.
export const INC1_ARTIFACTS = {
  "supabase/migrations/20261002120000_sales_v1_foundation.sql": "da1bc22619036249f36a67ff71641e7c4d54107dc10e5d0158349cefec0e73b2",
  "supabase/tests/rollback/sales_v1_foundation_rollback.sql": "cb934086c045131912318221b38663338f2b80358f90c842492db57f9cbc5b8f",
  "supabase/tests/sales_v1_foundation.expected.mjs": "4ac9d43d4ee14e2b9caf915537ae4e26d12d11322a4753b4c6aa70d2a90bb4ba",
  "supabase/tests/sales_v1_foundation.suite.mjs": "967d811d53d3befae440716efee6bb0587e984f1c54bf383fc10cbee07fe10f2",
  "supabase/tests/sales_v1_foundation.integration.mjs": "5026ff0cc708e3e2d8b675e098c288d63f47f726910192f54b0b37a5d58512f0",
  "supabase/tests/sales_v1_foundation.postgres.mjs": "a9ff707cbdac726f229c91dd47c76d6b2df38fffc1eb528a9f063e34059d2143",
  "supabase/tests/sales_v1_foundation.sabotage.mjs": "4596b735b71085b0989d9697530fec2a78a9314e490a59aa3cfa07097d1061d0",
  "supabase/tests/sales_v1_foundation.staging_acceptance.sql": "c597ae2927713d33c1f751660a5ed6df4976f87608bcdb0c0ae1dd1eeaa7e240",
  "supabase/tests/validate_sales_v1_foundation.mjs": "b563a4950e9264d0957d42f24447f96ffd419ed1b7e00eb9643f057a22e51505",
};

// Files Increment 2 adds (the cumulative validator checks this inventory).
export const INC2_FILES = [
  `supabase/migrations/${MIGRATION_FILE}`,
  "supabase/tests/rollback/sales_v1_leads_attribution_rollback.sql",
  "supabase/tests/sales_v1_leads.expected.mjs",
  "supabase/tests/sales_v1_leads.suite.mjs",
  "supabase/tests/sales_v1_leads.integration.mjs",
  "supabase/tests/sales_v1_leads.postgres.mjs",
  "supabase/tests/sales_v1_leads.sabotage.mjs",
  "supabase/tests/validate_sales_v1_leads.mjs",
];

export const FORBIDDEN_REFERENCES = [
  "public.clients",
  "client_notes",
  "member_module_access",
  "has_active_module_access",
  "can_manage_organization",
  "is_platform_owner",
  "email_contacts",
  "email_normalize_address",
  "builder_",
  "growth_system",
  "goal_engine",
  "orb_",
];
