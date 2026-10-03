// Email Marketing V1 - Increment 3b: TS renderer vs the PostgreSQL authority (PGlite).
//
// Run: npx -y -p @electric-sql/pglite node --test supabase/tests/email_marketing_v1_render_v1.differential.mjs
//
// 1. isRenderedHeaderSafe (TS) must agree with private.email_rendered_header_is_safe
//    on every string of a differential corpus (all committed vectors, every
//    code point of every forbidden range and its neighbours, line breaks,
//    encoded-word shapes, template/value boundaries, boundary lengths).
// 2. isUrlAllowed (TS) must agree with private.email_url_is_allowed.
// 3. Every template of both renderer fixtures is valid email-content.v1 for
//    PostgreSQL itself, and every successful render has SQL-safe headers.
// Any disagreement fails the suite: the SQL and the fixtures are the authority.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { A_FOUNDER, MIGRATIONS, createDatabase, readSql } from "./email_marketing_v1_harness.mjs";
import { isRenderedHeaderSafe, isUrlAllowed, renderTemplate } from "../functions/_shared/email/render_v1.ts";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const RENDER = fixture("email_render_v1_cases.json");
const DOCUMENT = fixture("email_render_v1_document_cases.json");
const cp = (n) => String.fromCodePoint(n);

async function inc3aDatabase() {
  const db = await createDatabase();
  for (const path of [MIGRATIONS.inc1, MIGRATIONS.inc2, MIGRATIONS.inc3a]) await db.exec(readSql(path));
  return db;
}

// Strings PostgreSQL text can hold: no U+0000, no unpaired surrogate.
const representable = (s) => typeof s === "string" && !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

function headerCorpus() {
  const corpus = new Set();
  const add = (s) => { if (representable(s)) corpus.add(s); };
  // Every code point of each forbidden range (and the header-only range), with
  // both neighbours, alone and embedded.
  const ranges = [[0x01, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x17b4, 0x17b5],
    [0x180b, 0x180f], [0x200b, 0x200b], [0x200c, 0x200d], [0x200e, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0x2800, 0x2800],
    [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xfffb], [0x1bca0, 0x1bca3],
    [0x1d173, 0x1d17a], [0xe0000, 0xe00ff], [0xe0100, 0xe01ef], [0xe01f0, 0xe0fff]];
  for (const [low, high] of ranges) {
    for (let n = Math.max(1, low - 1); n <= high + 1; n += 1) {
      if (n >= 0xd800 && n <= 0xdfff) continue;
      add(cp(n));
      add("a" + cp(n) + "b");
    }
  }
  // Printable ASCII and Latin-1, plus a sweep of the BMP and astral planes.
  for (let n = 0x20; n <= 0x2ff; n += 1) add("x" + cp(n));
  for (let n = 0x300; n < 0x10000; n += 97) if (n < 0xd800 || n > 0xdfff) add(cp(n));
  for (let n = 0x10000; n <= 0x10ffff; n += 4093) add(cp(n));
  for (const n of [0x1f381, 0x1f469, 0x1f4bb, 0x845b, 0x10ffff, 0xe0fff, 0xe1000]) add("Hola " + cp(n));
  // Line breaks and their combinations.
  for (const s of ["\r", "\n", "\r\n", "\t", "\u0085", cp(0x2028), cp(0x2029), "a\r\nBcc: x", "a\nb", "a\tb", " ", "  ", ""]) add(s);
  // Encoded-word shapes, alone and across a template/value boundary.
  for (const s of ["=?", "?=", "= ?", "=?=?", "==?", "=??", "a=?b", "=?UTF-8?B?4oCuUGF5UGFs?=", "= ?UTF-8?B?4oCuUGF5UGFs?=",
    "=" + "?utf-8?q?x?=", "Precio =", "?utf-8?q?x?=", "=\n?", "=\r?", "= \u0085?", "=" + cp(0x200b) + "?", "=" + cp(0xe0100) + "?"]) add(s);
  // Boundary lengths (header safety is length-independent; included to prove it).
  for (const n of [199, 200, 201, 399, 400, 401, 499, 500, 501]) {
    add("o".repeat(n));
    add(cp(0x1f381).repeat(n));
  }
  // Every string of every committed vector, and every rendered header.
  for (const vector of [...RENDER.cases, ...DOCUMENT.cases]) {
    for (const s of [vector.template.subject, vector.template.preheader]) add(s);
    const v = vector.values;
    for (const s of [v.contact?.first_name, v.contact?.last_name, v.contact?.email, v.organization?.name, ...Object.values(v.custom ?? {})]) add(s);
    const result = renderTemplate(vector.template, vector.values);
    if (result.ok) { add(result.subject); add(result.preheader); }
  }
  for (const vector of DOCUMENT.cases) {
    if (vector.footer && typeof vector.footer === "object") for (const s of Object.values(vector.footer)) add(s);
  }
  return [...corpus];
}

function urlCorpus() {
  const urls = new Set(["https://a.example.com", "https://a.example.com/x?a=1&b=2#f", "https://a.example.com:8443/p",
    "https://localhost", "https://1.2.3.4/x", "https://a.example.com/<x>", "https://a.example.com/ x", "https://user@a.example.com",
    "http://a.example.com", "HTTPS://a.example.com", "https://a.example.com/\"x", "https://a.example.com/'x", "https://-a.example.com",
    "https://a-.example.com", "https://a.example.c0m", "https://a.example.com/" + "p".repeat(2030), "https://a.example.com/" + "p".repeat(2040),
    "mailto:hola@acme.example.com", "mailto:Hola@Acme.Example.com", "mailto:a.b+c@x.example.com", "mailto:.a@x.example.com",
    "mailto:a..b@x.example.com", "mailto:a@x", "mailto:a@x.example.com?subject=hi", "mailto:a@b@c.example.com", "mailto:",
    "mailto:a@-x.example.com", "mailto:" + "a".repeat(65) + "@x.example.com", "mailto:" + "a".repeat(64) + "@x.example.com",
    "javascript:alert(1)", "data:text/html,x", "", "https://", "https://a.example.com/\u{E9}", "https://" + "a".repeat(64) + ".example.com"]);
  for (const vector of [...RENDER.cases, ...DOCUMENT.cases]) {
    for (const block of vector.template.content.blocks) for (const key of ["url", "src", "href"]) if (typeof block[key] === "string") urls.add(block[key]);
    if (vector.footer && typeof vector.footer.unsubscribe_url === "string") urls.add(vector.footer.unsubscribe_url);
  }
  return [...urls];
}

test("header safety: TS isRenderedHeaderSafe == private.email_rendered_header_is_safe on the whole corpus", async () => {
  const db = await inc3aDatabase();
  const corpus = headerCorpus();
  assert.ok(corpus.length > 5000, `corpus size ${corpus.length}`);
  const sql = (await db.query(`select v.ord::int as ord, private.email_rendered_header_is_safe(v.value) as safe
    from unnest($1::text[]) with ordinality as v(value, ord) order by v.ord`, [corpus])).rows;
  assert.equal(sql.length, corpus.length);
  const disagreements = [];
  sql.forEach((row, index) => {
    const ts = isRenderedHeaderSafe(corpus[index]);
    if (ts !== row.safe) disagreements.push({ value: [...corpus[index]].map((c) => c.codePointAt(0).toString(16)).join(" ").slice(0, 80), ts, sql: row.safe });
  });
  assert.deepEqual(disagreements, [], `TS/SQL disagreements (${disagreements.length})`);
  const nullSql = (await db.query("select private.email_rendered_header_is_safe(null) as safe")).rows[0].safe;
  assert.equal(isRenderedHeaderSafe(null), nullSql, "null");
  const safe = sql.filter((row) => row.safe).length;
  assert.ok(safe > 100 && corpus.length - safe > 100, `both verdicts exercised (safe ${safe}, unsafe ${corpus.length - safe})`);
  console.log(`header corpus: ${corpus.length} strings, ${safe} safe, ${corpus.length - safe} unsafe, 0 disagreements`);
});

test("URL revalidation: TS isUrlAllowed == private.email_url_is_allowed (https only and https|mailto)", async () => {
  const db = await inc3aDatabase();
  const corpus = urlCorpus();
  for (const allowMailto of [false, true]) {
    const rows = (await db.query(`select v.ord::int as ord, private.email_url_is_allowed(v.value, $2) as ok
      from unnest($1::text[]) with ordinality as v(value, ord) order by v.ord`, [corpus, allowMailto])).rows;
    rows.forEach((row, index) => assert.equal(isUrlAllowed(corpus[index], allowMailto), row.ok, `${corpus[index].slice(0, 60)} (mailto ${allowMailto})`));
    assert.ok(rows.some((row) => row.ok) && rows.some((row) => !row.ok), "both verdicts exercised");
  }
});

test("every fixture template is valid email-content.v1 for PostgreSQL; every successful render has SQL-safe headers", async () => {
  const db = await inc3aDatabase();
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A_FOUNDER}', false);`);
  for (const [key, type, options] of [["plan", "select", ["pro", "basico"]], ["score", "number", null], ["limit", "number", null],
    ["vip", "boolean", null], ["birthday", "date", null]]) {
    await db.query("select * from public.email_create_custom_field($1, $2, $3, $4::jsonb)", [key, key, type, options === null ? null : JSON.stringify(options)]);
  }
  for (const vector of [...RENDER.cases, ...DOCUMENT.cases]) {
    const verdict = (await db.query("select public.email_validate_content($1, $2, $3::jsonb) as r",
      [vector.template.subject, vector.template.preheader, JSON.stringify(vector.template.content)])).rows[0].r;
    assert.equal(verdict.valid, true, `${vector.name}: ${JSON.stringify(verdict)}`);
  }
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  for (const vector of [...RENDER.cases, ...DOCUMENT.cases]) {
    const result = renderTemplate(vector.template, vector.values);
    if (!result.ok) continue;
    for (const header of [result.subject, result.preheader]) {
      if (header === null) continue;
      const safe = (await db.query("select private.email_rendered_header_is_safe($1) as s", [header])).rows[0].s;
      assert.equal(safe, true, `${vector.name}: rendered header is SQL-safe`);
    }
  }
});
