import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function public.current_user_organization_id() returns uuid language sql stable as $$
    select nullif(current_setting('app.current_org', true), '')::uuid
  $$;
  create table public.knowledge_documents (
    id uuid primary key,
    organization_id uuid not null,
    unique (organization_id, id)
  );
  create table public.knowledge_document_versions (
    id uuid primary key,
    organization_id uuid not null,
    document_id uuid not null,
    extraction_status text not null,
    extracted_text text,
    checksum_sha256 text,
    updated_at timestamptz not null default now(),
    unique (organization_id, id),
    foreign key (organization_id, document_id)
      references public.knowledge_documents (organization_id, id)
  );
  alter table public.knowledge_document_versions enable row level security;
`);

const migration = await readFile(
  new URL("../migrations/20260825211531_brain_knowledge_chunking_v1.sql", import.meta.url),
  "utf8",
);
await db.exec(migration);

const organizationA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const documentA = "11111111-1111-4111-8111-111111111111";
const documentB = "22222222-2222-4222-8222-222222222222";
const versionA = "33333333-3333-4333-8333-333333333333";
const versionB = "44444444-4444-4444-8444-444444444444";
const lease = "55555555-5555-4555-8555-555555555555";

await db.query(
  `insert into public.knowledge_documents values ($1, $2), ($3, $4)`,
  [documentA, organizationA, documentB, organizationB],
);
await db.query(
  `insert into public.knowledge_document_versions
    (id, organization_id, document_id, extraction_status, extracted_text, checksum_sha256)
   values ($1, $2, $3, 'completed', 'Texto certificado.', repeat('a', 64)),
          ($4, $5, $6, 'completed', 'Otro texto.', repeat('b', 64))`,
  [versionA, organizationA, documentA, versionB, organizationB, documentB],
);

const claim = await db.query(
  `select * from public.claim_knowledge_document_chunking($1, $2, 'orvesen-hierarchical-v1')`,
  [versionA, lease],
);
assert.equal(claim.rows.length, 1);
assert.equal(claim.rows[0].organization_id, organizationA);

const chunks = [{
  chunk_index: 0,
  content: "Texto certificado.",
  content_hash: "c".repeat(64),
  token_count: 3,
  heading_path: [],
  source_start: 0,
  source_end: 18,
  metadata: { tokenizer: "orvesen-lexical-v1" },
}];
const completed = await db.query(
  `select public.complete_knowledge_document_chunking($1, $2, $3, $4::jsonb) as completed`,
  [versionA, lease, "orvesen-hierarchical-v1", JSON.stringify(chunks)],
);
assert.equal(completed.rows[0].completed, true);

const repeatedClaim = await db.query(
  `select * from public.claim_knowledge_document_chunking($1, $2, 'orvesen-hierarchical-v1')`,
  [versionA, "66666666-6666-4666-8666-666666666666"],
);
assert.equal(repeatedClaim.rows.length, 0, "completed generation is idempotent");

const stored = await db.query(
  `select organization_id, document_id, version_id, count(*)::integer as count
   from public.knowledge_document_chunks group by organization_id, document_id, version_id`,
);
assert.deepEqual(stored.rows, [{
  organization_id: organizationA,
  document_id: documentA,
  version_id: versionA,
  count: 1,
}]);

await db.exec(`set role authenticated; select set_config('app.current_org', '${organizationA}', false);`);
const ownOrganizationRows = await db.query(`select count(*)::integer as count from public.knowledge_document_chunks`);
assert.equal(ownOrganizationRows.rows[0].count, 1, "authenticated can read its organization chunks");
await db.exec(`select set_config('app.current_org', '${organizationB}', false);`);
const otherOrganizationRows = await db.query(`select count(*)::integer as count from public.knowledge_document_chunks`);
assert.equal(otherOrganizationRows.rows[0].count, 0, "RLS hides another organization chunks");
await db.exec("reset role");

await db.exec("set role anon");
await assert.rejects(
  () => db.query(`select * from public.knowledge_document_chunks`),
  /permission denied/,
);
await db.exec("reset role");

await assert.rejects(
  () => db.query(
    `insert into public.knowledge_document_chunks (
       organization_id, document_id, version_id, chunk_index, content, content_hash,
       source_checksum_sha256, token_count, chunker_version
     ) values ($1, $2, $3, 0, 'Ataque', repeat('d', 64), repeat('a', 64), 1, 'attack-v1')`,
    [organizationA, documentA, versionB],
  ),
  /foreign key constraint/,
);

const privileges = await db.query(`
  select
    has_table_privilege('anon', 'public.knowledge_document_chunks', 'select') as anon_select,
    has_table_privilege('authenticated', 'public.knowledge_document_chunks', 'select') as auth_select,
    has_table_privilege('authenticated', 'public.knowledge_document_chunks', 'insert') as auth_insert,
    has_function_privilege('authenticated', 'public.claim_knowledge_document_chunking(uuid,uuid,text)', 'execute') as auth_claim,
    has_function_privilege('service_role', 'public.claim_knowledge_document_chunking(uuid,uuid,text)', 'execute') as service_claim
`);
assert.deepEqual(privileges.rows[0], {
  anon_select: false,
  auth_select: true,
  auth_insert: false,
  auth_claim: false,
  service_claim: true,
});

console.log("migration validation passed: schema, atomic completion, idempotency, RLS, FK isolation and grants");
await db.close();
