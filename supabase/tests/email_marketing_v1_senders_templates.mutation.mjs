// Mutation (sabotage) runner for Email Marketing V1 - Increment 3a.
//
// Applies deliberate security/invariant defects to a temporary copy of the
// Increment 3a migration and runs the static validator and the integration
// suite against each copy. The unmodified migration must pass both (control).
//
// Every mutant declares its expected detection class:
// * behavioral  - the environment can exercise the behavior, so it only
//                 counts as killed when the INTEGRATION suite fails in a test
//                 matching `expect` (unrelated failures do not count).
// * static-only - the behavior cannot be exercised here (reason given); it
//                 counts as killed when the STATIC suite fails in a test
//                 matching `expect`.
// Temporary files live in the OS temp directory and are removed afterwards.
//
// Run:
//   npx -y -p @electric-sql/pglite node supabase/tests/email_marketing_v1_senders_templates.mutation.mjs

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readText } from "./email_marketing_v1_migration_order.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(here, "../migrations/20260929120000_email_marketing_v1_senders_templates.sql");
const SUITES = {
  static: resolve(here, "validate_email_marketing_v1_senders_templates.mjs"),
  integration: resolve(here, "email_marketing_v1_senders_templates.integration.mjs"),
};
// Mutation anchors are LF; the migration is normalized first so a CRLF
// checkout (core.autocrlf=true) finds exactly the same targets.
const original = readText(MIGRATION);
const B = "behavioral";
const S = "static-only";

const MUTANTS = [
  { name: "email_can grants the new actions to plain members", kind: B, expect: /^email_can: every existing decision/,
    edits: [["        and membership.role in ('founder', 'admin')\n    ),\n    false\n  );\n$$;\n\n-- ---------------------------------------------------------------------------\n-- Audit",
      "        and membership.role in ('founder', 'admin', 'member')\n    ),\n    false\n  );\n$$;\n\n-- ---------------------------------------------------------------------------\n-- Audit"]] },
  { name: "email_can silently drops an existing capability (lift_suppression)", kind: B, expect: /^email_can: every existing decision/,
    edits: [["      'lift_suppression',\n      'manage_senders',", "      'manage_senders',"]] },
  { name: "template versions become updatable", kind: B, expect: /^immutability and lifecycle invariants/,
    edits: [["before update or delete on public.email_template_versions", "before delete on public.email_template_versions"]] },
  { name: "RLS policy on templates loses the tenant predicate", kind: B, expect: /^(tenant isolation|new objects: RLS)/,
    edits: [["create policy email_templates_select on public.email_templates\nfor select to authenticated\nusing (organization_id = (select public.current_user_organization_id()) and",
      "create policy email_templates_select on public.email_templates\nfor select to authenticated\nusing (true and"]] },
  { name: "authenticated receives direct INSERT on templates", kind: B, expect: /^(API roles hold exactly|direct DML is forbidden)/,
    edits: [["comment on table public.email_sender_domains is", "grant insert on table public.email_templates to authenticated;\ncomment on table public.email_sender_domains is"]] },
  { name: "javascript: URLs are accepted", kind: B, expect: /^fixtures: every invalid case/,
    edits: [["  if url like 'https://%' then", "  if url like 'javascript:%' then\n    return true;\n  end if;\n  if url like 'https://%' then"]] },
  { name: "raw HTML detection disabled entirely", kind: B, expect: /^(fixtures: every invalid case|H1:)/,
    edits: [["  select coalesce(\n    value ~ '<[ \\n]*[A-Za-z!/?]'\n    or regexp_replace(value, '\\{\\{[^{}]*\\}\\}', 'x', 'g') ~ '<[ \\n]*[A-Za-z!/?]',\n    false);",
      "  select false;"]] },
  { name: "H1: raw HTML no longer checked with merge tags substituted", kind: B, expect: /^(H1:|fixtures: every invalid case)/,
    edits: [["\n    or regexp_replace(value, '\\{\\{[^{}]*\\}\\}', 'x', 'g') ~ '<[ \\n]*[A-Za-z!/?]',", ","]] },
  { name: "unknown merge tags accepted", kind: B, expect: /^fixtures: every invalid case/,
    edits: [["      perform private.email_content_invalid(location, 'unknown merge tag: ' || tag_path);", "      null;"]] },
  { name: "archived custom fields accepted as merge tags", kind: B, expect: /^(fixtures: every invalid case|generated boundaries|M2:)/,
    edits: [["        and field.key = substr(tag_path, 8)\n        and field.status = 'active'\n    ) then", "        and field.key = substr(tag_path, 8)\n    ) then"]] },
  { name: "L1: right-to-left mark (U+200F) no longer rejected", kind: B, expect: /^(sender identities: creation|fixtures: every invalid case)/,
    edits: [["|| chr(8206) || '-' || chr(8207) ||", "|| chr(8206) ||"]] },
  { name: "display name allows header injection and address spoofing", kind: B, expect: /^sender identities: creation/,
    edits: [["    and not private.email_text_has_header_unsafe_chars(value)\n    and value !~ '[<>\"\\\\@]'\n    and strpos(value, '=?') = 0,", "    and true,"]] },
  { name: "mailto: accepts a query string (bcc injection)", kind: B, expect: /^fixtures: every invalid case/,
    edits: [["    return mailbox ~ '^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$'", "    return mailbox ~ '^[A-Za-z0-9._+?=-]+@[A-Za-z0-9.?=@-]+$'"]] },
  { name: "audit stores the plaintext sender address", kind: B, expect: /^audit: every mutation/,
    edits: [["'address_hash', private.email_address_hash(sender_address),", "'address_hash', sender_address,"]] },
  { name: "M6: reply_to change audited without evidence", kind: B, expect: /^audit: every mutation/,
    edits: [["then private.email_address_hash(next_reply_to) end,", "then null end,"]] },
  { name: "M6: version creation no longer audited", kind: B, expect: /^(audit: every mutation|M1:|M2:)/,
    edits: [["  perform private.email_write_audit(new.organization_id, 'email.template_version.created'",
      "  /* perform private.email_write_audit(new.organization_id, 'email.template_version.created'"],
    ["                       'created_by', new.created_by));\n  return null;",
      "                       'created_by', new.created_by)); */\n  return null;"]] },
  { name: "M1 (pass 2): version audit moved back to the BEFORE guard (phantom rows on skipped inserts)", kind: B,
    expect: /^M1 \(pass 2\):/,
    edits: [["  perform private.email_write_audit(new.organization_id, 'email.template_version.created'",
      "  /* perform private.email_write_audit(new.organization_id, 'email.template_version.created'"],
    ["                       'created_by', new.created_by));\n  return null;",
      "                       'created_by', new.created_by)); */\n  return null;"],
    ["  new.created_at := now();\n  return new;",
      "  new.created_at := now();\n  perform private.email_write_audit(new.organization_id, 'email.template_version.created', 'template_version', new.id,\n"
      + "    jsonb_build_object('template_id', new.template_id, 'version_number', new.version_number, 'content_sha256', new.content_sha256,\n"
      + "                       'block_count', jsonb_array_length(new.content -> 'blocks'), 'merge_tag_count', new.merge_tag_count,\n"
      + "                       'merge_tags_sha256', new.merge_tags_sha256, 'created_by', new.created_by));\n  return new;"]] },
  { name: "M3 (pass 2): post-lock custom-field re-check removed", kind: B, expect: /^M3 \(pass 2\):/,
    edits: [["      for share;\n      if not found then\n        perform private.email_content_invalid(tag_location, 'unknown merge tag: ' || tag_path);\n      end if;",
      "      for share;"]] },
  { name: "L3 (pass 3): post-lock re-check reports a generic location", kind: B, expect: /^M3 \(pass 2\):/,
    edits: [["        perform private.email_content_invalid(tag_location, 'unknown merge tag: ' || tag_path);",
      "        perform private.email_content_invalid('content', 'unknown merge tag: ' || tag_path);"]] },
  { name: "L5 (pass 3): created_by may differ from the session actor", kind: B, expect: /^L5:/,
    edits: [["  if (select auth.uid()) is not null and new.created_by is distinct from (select auth.uid()) then\n"
      + "    raise exception using errcode = '42501', message = 'EMAIL_ACTOR_MISMATCH';\n  end if;\n", ""]] },
  { name: "M1 (pass 3): subject and preheader accept RFC 2047 encoded words", kind: B, expect: /^(fixtures: every invalid case|header rules:)/,
    edits: [["    when strpos(value, '=?') > 0 then 'encoded words are not allowed'\n", ""]] },
  { name: "L4 (pass 4): the column CHECK uses a weaker copy of the header rules", kind: B, expect: /^header rules:/,
    edits: [["  select private.email_header_text_problem(value, max_length) is null;",
      "  select coalesce(char_length(value) between 1 and max_length and value = btrim(value)\n    and not private.email_text_has_unsafe_chars(value, false), false);"]] },
  { name: "L1 (pass 4): Mongolian free variation selectors (U+180B-U+180D, U+180F) no longer rejected", kind: B,
    expect: /^(sender identities: creation|fixtures: every invalid case)/,
    edits: [["chr(6155) || '-' || chr(6159)", "chr(6158)"]] },
  { name: "L1 (pass 4): shorthand format controls (U+1BCA0-U+1BCA3) no longer rejected", kind: B,
    expect: /^(sender identities: creation|fixtures: every invalid case)/,
    edits: [["|| chr(113824) || '-' || chr(113827) || chr(119155)", "|| chr(119155)"]] },
  { name: "L1 (pass 3): braille pattern blank (U+2800) no longer rejected", kind: B, expect: /^(sender identities: creation|fixtures: every invalid case)/,
    edits: [["|| chr(10240) || chr(12644)", "|| chr(12644)"]] },
  { name: "L1 (pass 3): musical format controls (U+1D173-U+1D17A) no longer rejected", kind: B, expect: /^(sender identities: creation|fixtures: every invalid case)/,
    edits: [[" || chr(119155) || '-' || chr(119162)", ""]] },
  { name: "L1 (pass 2): soft hyphen (U+00AD) no longer rejected", kind: B, expect: /^(sender identities: creation|fixtures: every invalid case)/,
    edits: [["chr(159) || chr(173) || chr(847)", "chr(159) || chr(847)"]] },
  { name: "L1 (pass 2): tag characters (U+E0000-U+E007F) no longer rejected", kind: B, expect: /^(sender identities: creation|fixtures: every invalid case)/,
    edits: [["\n         || chr(917504) || '-' || chr(917759) || chr(918000)", "\n         || chr(918000)"]] },
  { name: "M1 (pass 5): reserved default-ignorables U+E0080-U+E00FF no longer rejected", kind: B, expect: /^(sender identities: creation|fixtures: every invalid case)/,
    edits: [["chr(917504) || '-' || chr(917759)", "chr(917504) || '-' || chr(917631)"]] },
  { name: "M1 (pass 5): reserved default-ignorables U+E01F0-U+E0FFF no longer rejected", kind: B, expect: /^(sender identities: creation|fixtures: every invalid case)/,
    edits: [[" || chr(918000) || '-' || chr(921599)", ""]] },
  { name: "M1 (pass 5): reserved specials U+FFF0-U+FFF8 no longer rejected", kind: B, expect: /^(sender identities: creation|fixtures: every invalid case)/,
    edits: [["chr(65520) || '-' || chr(65531)", "chr(65529) || '-' || chr(65531)"]] },
  { name: "M1 (pass 5): header fields accept ideographic variation selectors", kind: B, expect: /^(sender identities: creation|fixtures: every invalid case)/,
    edits: [["\n    or coalesce(value ~ ('[' || chr(917760) || '-' || chr(917999) || ']'), false);", ";"]] },
  { name: "M1 (pass 5): from_name uses the general set instead of the header set", kind: B, expect: /^sender identities: creation/,
    edits: [["    and not private.email_text_has_header_unsafe_chars(value)\n    and value !~", "    and not private.email_text_has_unsafe_chars(value, false)\n    and value !~"]] },
  { name: "LOW 2 (pass 5): template name CHECK back to a POSIX class", kind: B, expect: /^immutability and lifecycle invariants/,
    edits: [["    and not private.email_text_has_unsafe_chars(name, false)),", "    and name !~ '[[:cntrl:]]'),"]] },
  { name: "M2 (pass 6): template RPC skips the explicit character check (CHECK error leaks instead)", kind: B, expect: /^templates: creation/,
    edits: [["     or private.email_text_has_unsafe_chars(cleaned_name, false)\n", ""],
      ["\n         or private.email_text_has_unsafe_chars(cleaned_description, false)", ""]] },
  { name: "S2 (pass 6): template RPC routed back to the locale-dependent Increment 2 label helpers", kind: B, expect: /^templates: creation/,
    edits: [["  cleaned_name text := btrim(p_name);\n  cleaned_description text := nullif(btrim(p_description), '');",
      "  cleaned_name text := private.email_clean_label(p_name, 100);\n  cleaned_description text := private.email_clean_description(p_description);"],
      ["     or private.email_text_has_unsafe_chars(cleaned_name, false)\n", ""],
      ["\n         or private.email_text_has_unsafe_chars(cleaned_description, false)", ""]] },
  { name: "S1 (pass 6): final rendered header check no longer rejects ideographic variation selectors", kind: B, expect: /^pass 6:/,
    edits: [["  select coalesce(value is not null\n    and not private.email_text_has_header_unsafe_chars(value)\n",
      "  select coalesce(value is not null\n    and not private.email_text_has_unsafe_chars(value, false)\n"]] },
  { name: "M1 (pass 6): final rendered header check accepts RFC 2047 encoded words", kind: B, expect: /^pass 6:/,
    edits: [["    and not private.email_text_has_header_unsafe_chars(value)\n    and strpos(value, '=?') = 0, false);\n$$;",
      "    and not private.email_text_has_header_unsafe_chars(value), false);\n$$;"]] },
  { name: "RFC 2047 encoded words accepted in the display name", kind: B, expect: /^sender identities: creation/,
    edits: [["    and value !~ '[<>\"\\\\@]'\n    and strpos(value, '=?') = 0,", "    and value !~ '[<>\"\\\\@]',"]] },
  { name: "L4 (pass 3): an unusable 253-character sender domain is accepted", kind: B, expect: /^sender domains: normalization/,
    edits: [["char_length(candidate) > 252", "char_length(candidate) > 253"],
      ["check (char_length(domain) between 3 and 252 and", "check (char_length(domain) between 3 and 253 and"]] },
  { name: "domain normalizer rejects usable 244..252-character domains again", kind: B, expect: /^sender domains: normalization/,
    edits: [["char_length(candidate) > 252", "char_length(candidate) > 243"]] },
  { name: "M1: audit stores the unbounded merge-tag list", kind: B, expect: /^(M1:|audit: every mutation)/,
    edits: [["                       'merge_tag_count', new.merge_tag_count,",
      "                       'merge_tags', to_jsonb(private.email_content_validate(new.organization_id, new.subject, new.preheader, new.content)),\n"
      + "                       'merge_tag_count', new.merge_tag_count,"]] },
  { name: "M2: validation runs before the exact-retry check", kind: B, expect: /^M2:/,
    edits: [["  payload_hash := private.email_template_content_hash(cleaned_subject, cleaned_preheader, p_content);\n  if template_row.latest_version > 0 then",
      "  perform private.email_content_validate(organization, cleaned_subject, cleaned_preheader, p_content);\n  payload_hash := private.email_template_content_hash(cleaned_subject, cleaned_preheader, p_content);\n  if template_row.latest_version > 0 then"]] },
  { name: "M2: referenced custom fields are not share-locked", kind: S, expect: /^M2:/,
    reason: "the lock only matters against a concurrent archive; PGlite has a single connection",
    edits: [["        and field.status = 'active'\n      for share;", "        and field.status = 'active';"]] },
  { name: "M3: template create loses its retry (single attempt)", kind: B, expect: /^M3:/,
    edits: [["  for attempt in 1..3 loop\n    insert into public.email_templates", "  for attempt in 1..1 loop\n    insert into public.email_templates"]] },
  { name: "M3: identity create loses its retry (single attempt)", kind: B, expect: /^M3:/,
    edits: [["  for attempt in 1..3 loop\n    insert into public.email_sender_identities (", "  for attempt in 1..1 loop\n    insert into public.email_sender_identities ("]] },
  { name: "M4: merge-tag order uses the database default collation", kind: S, expect: /^content policy/,
    reason: "PGlite's default collation is C, so locale-dependent ordering is unobservable here",
    edits: [["order by tag_path collate \"C\"", "order by tag_path"]] },
  { name: "stale expected version no longer conflicts", kind: B, expect: /^template versions:/,
    edits: [["  if p_expected_latest_version <> template_row.latest_version then", "  if false then"]] },
  { name: "single-column foreign key allows cross-tenant domain references", kind: B, expect: /^tenant isolation/,
    edits: [["  foreign key (organization_id, domain_id)\n    references public.email_sender_domains (organization_id, id) on delete restrict,",
      "  foreign key (domain_id) references public.email_sender_domains (id) on delete restrict,"]] },
  { name: "an RPC loses its pinned search_path", kind: B, expect: /^new objects: RLS/,
    edits: [["returns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = ''", "returns jsonb\nlanguage plpgsql\nsecurity definer\nset search_path = public"]] },
  { name: "content mutation authorized with 'read' instead of 'manage_content'", kind: S, expect: /^RPCs authorize first/,
    reason: "founder/admin hold both actions in V1, so the two are behaviorally indistinguishable",
    edits: [["  organization uuid := private.email_require('manage_content');\n  cleaned_name text", "  organization uuid := private.email_require('read');\n  cleaned_name text"]] },
  { name: "reserved verification state becomes reachable", kind: B, expect: /^immutability and lifecycle invariants/,
    edits: [["check (verification_status in ('unverified'))", "check (verification_status in ('unverified', 'verified'))"],
      ["private.email_catalog_guard('domain', 'verification_status')", "private.email_catalog_guard('domain')"]] },
  { name: "client-supplied content hash is trusted", kind: B, expect: /^immutability and lifecycle invariants/,
    edits: [["  new.content_sha256 := private.email_template_content_hash(new.subject, new.preheader, new.content);\n", ""]] },
  { name: "domain with active identities can be archived", kind: B, expect: /^(sender domains: archive is blocked|immutability and lifecycle invariants)/,
    edits: [["  if old.status = 'active' and new.status = 'archived' and exists (", "  if false and exists ("],
      ["  if exists (select 1 from public.email_sender_identities as identity\n             where identity.organization_id = organization and identity.domain_id = current_row.id",
        "  if false and exists (select 1 from public.email_sender_identities as identity\n             where identity.organization_id = organization and identity.domain_id = current_row.id"]] },
  // The BEFORE guard is the only content-validation boundary for direct
  // inserts (the AFTER trigger no longer re-validates), so this mutant must be
  // caught by the owner-level immutability tests.
  { name: "insert guard skips content validation for direct inserts", kind: B,
    expect: /^immutability and lifecycle invariants/,
    edits: [["  merge_tags := private.email_content_validate(new.organization_id, new.subject, new.preheader, new.content);",
      "  merge_tags := array[]::text[];"]] },
];

// EMAIL_MUTATION_ONLY (exact names joined by "||") re-runs a subset, e.g. after a
// resource interruption; every requested name must exist.
const ONLY = process.env.EMAIL_MUTATION_ONLY ? process.env.EMAIL_MUTATION_ONLY.split("||") : null;
const SELECTED = ONLY ? MUTANTS.filter((mutant) => ONLY.includes(mutant.name)) : MUTANTS;
if (ONLY && SELECTED.length !== ONLY.length) throw new Error(`unknown mutant name in EMAIL_MUTATION_ONLY (${SELECTED.length}/${ONLY.length} matched)`);

function applyEdits(source, edits) {
  let result = source;
  for (const [from, to] of edits) {
    const occurrences = result.split(from).length - 1;
    if (occurrences !== 1) throw new Error(`mutation target must occur exactly once (found ${occurrences}): ${from.slice(0, 80)}`);
    result = result.replace(from, () => to);
  }
  return result;
}

function runSuite(file, migrationPath) {
  return new Promise((resolvePromise) => {
    // The spec reporter is forced: failure detection parses its "x name" lines,
    // and some Node versions default to TAP when stdout is not a TTY.
    const child = spawn(process.execPath, ["--test", "--test-reporter=spec", file], {
      env: { ...process.env, EMAIL_INC3A_MIGRATION_PATH: migrationPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (exitCode) => {
      const failures = [...new Set(output.split("\n")
        .filter((line) => line.startsWith("\u2716 ") && !line.startsWith("\u2716 failing tests"))
        .map((line) => line.slice(2).replace(/ \([\d.]+ms\)\s*$/, "")))];
      resolvePromise({ exitCode, failures });
    });
  });
}

async function evaluate(name, source, dir) {
  const path = join(dir, `${name.replace(/[^a-z0-9]+/gi, "_").slice(0, 60)}.sql`);
  writeFileSync(path, source, "utf8");
  const [staticResult, integrationResult] = await Promise.all([runSuite(SUITES.static, path), runSuite(SUITES.integration, path)]);
  return { name, staticResult, integrationResult };
}

const dir = mkdtempSync(join(tmpdir(), "email-inc3a-mutants-"));
let ok = true;
try {
  const control = await evaluate("control", original, dir);
  const controlPass = control.staticResult.exitCode === 0 && control.integrationResult.exitCode === 0;
  console.log(`${controlPass ? "PASS" : "FAIL"}  control (unmodified migration passes both suites)`);
  if (!controlPass) {
    ok = false;
    console.log(`      static: ${control.staticResult.failures.join(" | ")}\n      integration: ${control.integrationResult.failures.join(" | ")}`);
  }

  // LOW 1 (pass 6): a fresh Windows checkout (core.autocrlf=true) has CRLF
  // endings. The suites normalize on read, so the CRLF copy must pass; the
  // runner normalizes before applying LF anchors, so a CRLF source yields the
  // same mutant (checked byte-for-byte below and killed like any other).
  const crlfSource = original.split("\n").join("\r\n");
  const crlfPath = join(dir, "control_crlf_source.sql");
  writeFileSync(crlfPath, crlfSource, "utf8");
  const crlfControl = await evaluate("control_crlf", crlfSource, dir);
  const crlfPass = crlfControl.staticResult.exitCode === 0 && crlfControl.integrationResult.exitCode === 0;
  const probe = MUTANTS.find((mutant) => mutant.name.startsWith("S1 (pass 6)"));
  const crlfAnchorsMatch = applyEdits(readText(crlfPath), probe.edits) === applyEdits(original, probe.edits);
  console.log(`${crlfPass && crlfAnchorsMatch ? "PASS" : "FAIL"}  CRLF control (CRLF copy passes both suites; LF anchors apply to a CRLF checkout)`);
  if (!crlfPass || !crlfAnchorsMatch) {
    ok = false;
    console.log(`      anchors match: ${crlfAnchorsMatch}
      static: ${crlfControl.staticResult.failures.join(" | ")}
      integration: ${crlfControl.integrationResult.failures.join(" | ")}`);
  }

  const prepared = SELECTED.map((mutant) => ({ ...mutant, source: applyEdits(original, mutant.edits) }));
  const results = new Map();
  const queue = [...prepared];
  // EMAIL_MUTATION_WORKERS lowers parallelism on memory-constrained machines (default 4).
  await Promise.all(Array.from({ length: Number(process.env.EMAIL_MUTATION_WORKERS) || 4 }, async () => {
    while (queue.length) {
      const mutant = queue.shift();
      results.set(mutant.name, await evaluate(mutant.name, mutant.source, dir));
    }
  }));

  const tally = { [B]: { killed: 0, total: 0 }, [S]: { killed: 0, total: 0 } };
  for (const mutant of SELECTED) {
    const { staticResult, integrationResult } = results.get(mutant.name);
    const staticCaught = staticResult.exitCode !== 0;
    const integrationCaught = integrationResult.exitCode !== 0;
    const relevant = (result) => result.failures.filter((f) => mutant.expect.test(f));
    const required = mutant.kind === B ? integrationResult : staticResult;
    const killed = relevant(required).length > 0;
    tally[mutant.kind].total += 1;
    if (killed) tally[mutant.kind].killed += 1;
    else ok = false;
    console.log(`${killed ? "KILLED  " : "SURVIVED"}  [${mutant.kind}] ${mutant.name}`);
    console.log(`          static caught: ${staticCaught ? "YES" : "NO "}  integration caught: ${integrationCaught ? "YES" : "NO "}`
      + `  relevant ${mutant.kind === B ? "integration" : "static"} failure: ${relevant(required)[0] || "none"}`);
    if (mutant.kind === S) console.log(`          static-only because ${mutant.reason}`);
    if (!killed && required.failures.length) console.log(`          unrelated failures (not counted): ${required.failures.join(" | ")}`);
  }
  console.log(`\nbehavioral: ${tally[B].killed}/${tally[B].total} killed by relevant integration failures`);
  console.log(`static-only: ${tally[S].killed}/${tally[S].total} killed by relevant static failures`);
  console.log(`control ${controlPass ? "passes" : "FAILS"}; CRLF control ${crlfPass && crlfAnchorsMatch ? "passes" : "FAILS"}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
