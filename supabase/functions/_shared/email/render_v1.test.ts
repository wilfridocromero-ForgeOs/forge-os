// ORVESEN Email Marketing V1 - Increment 3b: renderer tests.
//
// The same file runs under both runtimes and must give identical results:
//   deno test --no-config --allow-read=. supabase/functions/_shared/email/render_v1.test.ts
//   node --test supabase/functions/_shared/email/render_v1.test.ts
// Each run prints "INC3B_DIGEST <sha256>" over every output it produced; the
// two digests are compared byte for byte by the Increment 3b runner.
//
// Expectations come from hand-authored fixtures and from reference checks
// written here (own escape function, own structural walk). The module's own
// helpers are never used to compute an expected value.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  assembleDocument,
  EmailRenderInputError,
  isRenderedHeaderSafe,
  renderTemplate,
} from "./render_v1.ts";

type Json = any; // fixtures are untyped JSON

const fixture = (name: string): Json =>
  JSON.parse(readFileSync(new URL("../../../tests/fixtures/" + name, import.meta.url), "utf8"));
const RENDER = fixture("email_render_v1_cases.json");
const DOCUMENT = fixture("email_render_v1_document_cases.json");
const SOURCE = readFileSync(new URL("./render_v1.ts", import.meta.url), "utf8");

const digest = createHash("sha256");
const record = (label: string, value: unknown) => digest.update(label + "\u0000" + JSON.stringify(value) + "\u0000");

// Reference escape (contract section 7.2), written independently of the module.
function refEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const BLOCK_KEYS: Record<string, string[]> = {
  heading: ["type", "level", "text", "html"],
  paragraph: ["type", "text", "html"],
  button: ["type", "text", "url", "html", "href_attr"],
  image: ["type", "src", "alt", "href", "width", "src_attr", "alt_attr", "href_attr"],
  divider: ["type"],
  spacer: ["type", "height"],
};

test("frozen render vectors (35): exact expected output, no partial output on failure", () => {
  assert.equal(RENDER.cases.length, 35, "the frozen vector set is complete");
  for (const vector of RENDER.cases) {
    const result: Json = renderTemplate(vector.template, vector.values);
    record("render:" + vector.name, result);
    const expected = vector.expected;
    if (expected.error !== undefined) {
      assert.deepEqual(result, { ok: false, ...expected }, vector.name + ": failure is exactly the expected code (no partial output)");
      continue;
    }
    assert.equal(result.ok, true, vector.name);
    assert.deepEqual(Object.keys(result), ["ok", "subject", "preheader", "preheader_html", "blocks"], vector.name + ": result keys/order");
    assert.equal(result.subject, expected.subject, vector.name + ": subject");
    assert.equal(result.preheader_html, expected.preheader_html, vector.name + ": preheader_html");
    assert.equal(result.preheader === null ? null : refEscape(result.preheader), result.preheader_html, vector.name + ": preheader_html = escape(preheader)");
    assert.equal(result.blocks.length, expected.blocks.length, vector.name + ": block count");
    // Walk the template in order: omitted blocks are skipped, never reordered.
    const source = vector.template.content.blocks;
    let cursor = 0;
    result.blocks.forEach((block: Json, index: number) => {
      const want = expected.blocks[index];
      const label = vector.name + ": block " + String(index + 1);
      for (const key of Object.keys(want)) assert.deepEqual(block[key], want[key], label + " " + key);
      const allowed = BLOCK_KEYS[block.type];
      assert.ok(allowed !== undefined, label + ": known type");
      for (const key of Object.keys(block)) assert.ok(allowed.includes(key), label + ": no unexpected key " + key);
      while (cursor < source.length && source[cursor].type !== block.type) cursor += 1;
      assert.ok(cursor < source.length, label + ": comes from a template block of the same type, in order");
      const origin = source[cursor];
      cursor += 1;
      if (block.type === "heading") {
        assert.equal(block.level, origin.level, label + ": level from the template");
        assert.equal(block.html, refEscape(block.text), label + ": html = escape(text)");
      } else if (block.type === "paragraph") {
        assert.equal(block.html, refEscape(block.text).split("\n").join("<br>"), label + ": html = escape(text) with <br>");
      } else if (block.type === "button") {
        assert.equal(block.url, origin.url, label + ": url from the template");
        assert.equal(block.html, refEscape(block.text), label + ": html = escape(text)");
        assert.equal(block.href_attr, refEscape(block.url), label + ": href_attr = escape(url)");
      } else if (block.type === "image") {
        assert.equal(block.src, origin.src);
        assert.equal(block.alt, origin.alt);
        assert.equal(block.href, origin.href ?? null);
        assert.equal(block.width, origin.width ?? null);
        assert.equal(block.src_attr, refEscape(block.src));
        assert.equal(block.alt_attr, refEscape(block.alt));
        assert.equal(block.href_attr, block.href === null ? undefined : refEscape(block.href));
      } else if (block.type === "spacer") {
        assert.equal(block.height, origin.height);
      }
    });
  }
});

test("document vectors (hand-authored): exact HTML and text/plain, or the exact assembly error", () => {
  assert.ok(DOCUMENT.cases.length >= 20);
  for (const vector of DOCUMENT.cases) {
    const rendered: Json = renderTemplate(vector.template, vector.values);
    const result: Json = "footer" in vector ? assembleDocument(rendered, vector.footer) : (assembleDocument as Json)(rendered);
    record("document:" + vector.name, result);
    if (vector.expected.error !== undefined) {
      assert.deepEqual(result, { ok: false, ...vector.expected }, vector.name);
    } else {
      assert.deepEqual(Object.keys(result), ["ok", "html", "text"], vector.name + ": result keys/order");
      assert.equal(result.html, vector.expected.html, vector.name + ": html");
      assert.equal(result.text, vector.expected.text, vector.name + ": text");
    }
  }
});

test("mandatory footer: every successful document ends with exactly one system footer after all template content", () => {
  for (const vector of DOCUMENT.cases) {
    if (vector.expected.error !== undefined) continue;
    const result: Json = assembleDocument(renderTemplate(vector.template, vector.values), vector.footer);
    const marker = "<div data-orvesen-footer=\"email-footer.v1\">";
    assert.equal(result.html.split(marker).length - 1, 1, vector.name + ": one footer");
    assert.ok(result.html.endsWith("</p>\n</div>\n</body>\n</html>\n"), vector.name + ": footer closes the body");
    assert.ok(result.html.indexOf(marker) > result.html.indexOf("<body>"), vector.name);
    assert.ok(result.text.includes("\n-- \n") || result.text.startsWith("-- \n"), vector.name + ": text footer separator");
    assert.ok(result.text.endsWith(vector.footer.unsubscribe_label + ": " + vector.footer.unsubscribe_url + "\n"), vector.name + ": text footer last line");
  }
});

test("assembleDocument never trusts html/*_attr from its input: it re-escapes plain text and revalidates", () => {
  const base = DOCUMENT.cases[0];
  const rendered: Json = renderTemplate(base.template, base.values);
  const clean: Json = assembleDocument(rendered, base.footer);
  const tampered = JSON.parse(JSON.stringify(rendered));
  tampered.preheader_html = "<script>x</script>";
  for (const block of tampered.blocks) {
    if ("html" in block) block.html = "<script>alert(1)</script>";
    if ("href_attr" in block) block.href_attr = "javascript:alert(1)";
  }
  assert.deepEqual(assembleDocument(tampered, base.footer), clean, "injected html/attr fields are ignored");
  const unsafe = JSON.parse(JSON.stringify(rendered));
  unsafe.subject = "Hola\r\nBcc: x@example.com";
  assert.deepEqual(assembleDocument(unsafe, base.footer), { ok: false, error: "DOCUMENT_RENDER_INVALID", reason: "invalid subject" });
  const encodedWord = JSON.parse(JSON.stringify(rendered));
  encodedWord.preheader = "=?utf-8?q?x?=";
  assert.deepEqual(assembleDocument(encodedWord, base.footer), { ok: false, error: "DOCUMENT_RENDER_INVALID", reason: "invalid preheader" });
  const script = JSON.parse(JSON.stringify(rendered));
  script.blocks[2].url = "javascript:alert(1)";
  assert.deepEqual(assembleDocument(script, base.footer), { ok: false, error: "DOCUMENT_RENDER_INVALID", reason: "invalid button url" });
  const empty = JSON.parse(JSON.stringify(rendered));
  empty.blocks = [{ type: "divider" }];
  assert.deepEqual(assembleDocument(empty, base.footer), { ok: false, error: "DOCUMENT_RENDER_INVALID", reason: "no content blocks" });
  record("tamper", [clean]);
});

test("isRenderedHeaderSafe: hand-written expectations (TS mirror of private.email_rendered_header_is_safe)", () => {
  const cases: Array<[unknown, boolean]> = [
    ["Hola", true], ["", true], ["Precio = ?utf-8?q?x?=", true], ["Hola \u{1F381}", true],
    ["\u{200C}\u{200D}\u{FE0F}", true], ["a=?b", false], ["=?", false], ["a\nb", false], ["a\rb", false],
    ["a\tb", false], ["a\u0085b", false], ["a\u{2028}b", false], ["a\u{2029}b", false], ["a\u{202E}b", false],
    ["a\u{E0100}b", false], ["a\u{E01EF}b", false], ["a\u{E01F0}b", false], ["a\u{E00FF}b", false], ["a\u{E0FFF}b", false],
    ["a\u{E1000}b", true], ["a\u{AD}b", false], ["a\u{3164}b", false], ["a\u{1D173}b", false],
    ["a\u0000b", false], ["a\uD800b", false], ["a\uDC00b", false], [null, false], [undefined, false], [42, false],
  ];
  for (const [value, expected] of cases) {
    assert.equal(isRenderedHeaderSafe(value), expected, JSON.stringify(value));
  }
  record("header", cases.map(([value]) => isRenderedHeaderSafe(value)));
});

test("failure precedence inside one field and across fields (contract 7.1: empty -> unsafe header -> length; subject -> preheader -> blocks; EMPTY_BODY last)", () => {
  const values = (first: string) => ({ contact: { first_name: first, last_name: null }, organization: { name: "Acme" }, custom: {}, archived_custom: [] });
  const doc = (subject: string, preheader: string | null, blocks: Json[]) => ({ subject, preheader, content: { version: "email-content.v1", blocks } });
  const unsafeAndLong = "a".repeat(450) + "\u{E0100}";
  const cases: Array<[Json, Json, Json]> = [
    [doc("{{contact.first_name}}", null, [{ type: "paragraph", text: "x" }]), values(unsafeAndLong), { ok: false, error: "RENDER_UNSAFE_HEADER", location: "subject" }],
    [doc("Hola", "{{contact.first_name}}", [{ type: "paragraph", text: "x" }]), values("a".repeat(600) + "\u{E0100}"), { ok: false, error: "RENDER_UNSAFE_HEADER", location: "preheader" }],
    [doc("Hola", "{{contact.first_name}}", [{ type: "heading", level: 1, text: "{{contact.first_name}}" }]), values("a".repeat(1200)), { ok: false, error: "RENDER_FIELD_TOO_LONG", location: "preheader" }],
    [doc("Hola", null, [{ type: "paragraph", text: "{{contact.last_name}}" }, { type: "heading", level: 1, text: "{{contact.first_name}}" }]), values("a".repeat(1001)), { ok: false, error: "RENDER_FIELD_TOO_LONG", location: "block 2" }],
    [doc("Hola", null, [{ type: "heading", level: 1, text: "{{contact.first_name}}" }]), values("\u{E0100}"), { ok: true, subject: "Hola", preheader: null, preheader_html: null, blocks: [{ type: "heading", level: 1, text: "\u{E0100}", html: "\u{E0100}" }] }],
  ];
  for (const [version, vals, expected] of cases) {
    const result = renderTemplate(version, vals);
    assert.deepEqual(result, expected, JSON.stringify(expected).slice(0, 80));
    record("precedence", result);
  }
});

test("TS-only input hardening (contract 9.5): NUL and lone surrogates are removed; non-string values are absent", () => {
  const template = { subject: "Hola {{contact.first_name}}", preheader: null, content: { version: "email-content.v1", blocks: [{ type: "paragraph", text: "{{contact.last_name|vacio}}" }] } };
  const values = { contact: { first_name: "A\u0000n\uD800a", last_name: 42 }, organization: { name: "Acme" }, custom: {}, archived_custom: [] };
  const result: Json = renderTemplate(template, values);
  assert.deepEqual(result, { ok: true, subject: "Hola Ana", preheader: null, preheader_html: null, blocks: [{ type: "paragraph", text: "vacio", html: "vacio" }] });
  record("hardening", result);
});

test("structurally impossible input throws RENDER_INPUT_INVALID (never a per-contact result)", () => {
  const values = { contact: {}, organization: { name: "Acme" }, custom: {}, archived_custom: [] };
  const bad: Json[] = [
    null,
    { subject: 1, preheader: null, content: { version: "email-content.v1", blocks: [] } },
    { subject: "Hola", preheader: null, content: { version: "email-content.v2", blocks: [] } },
    { subject: "Hola", preheader: null, content: { version: "email-content.v1", blocks: [{ type: "video" }] } },
    { subject: "Hola", preheader: null, content: { version: "email-content.v1", blocks: [{ type: "heading", text: "x" }] } },
  ];
  for (const version of bad) {
    assert.throws(() => renderTemplate(version, values), (error: unknown) => {
      assert.ok(error instanceof EmailRenderInputError);
      assert.equal((error as EmailRenderInputError).code, "RENDER_INPUT_INVALID");
      return true;
    });
  }
});

test("determinism: every case renders and assembles to identical bytes twice, with fixed key order", () => {
  for (const vector of [...RENDER.cases, ...DOCUMENT.cases]) {
    const once = JSON.stringify(renderTemplate(vector.template, vector.values));
    const twice = JSON.stringify(renderTemplate(vector.template, vector.values));
    assert.equal(once, twice, vector.name);
    if ("footer" in vector) {
      assert.equal(JSON.stringify(assembleDocument(JSON.parse(once), vector.footer)),
        JSON.stringify(assembleDocument(JSON.parse(twice), vector.footer)), vector.name);
    }
  }
});

test("purity gate: no imports, I/O, network, database, clock, randomness, environment or dynamic code; ASCII source", () => {
  assert.ok([...SOURCE].every((ch) => ch.charCodeAt(0) < 128), "ASCII only");
  const code = SOURCE.replace(/\/\/[^\n]*/g, "");
  assert.ok(!/^\s*import\s/m.test(code) && !/\bimport\s*\(/.test(code) && !/\brequire\s*\(/.test(code), "no imports of any kind");
  for (const banned of [
    /\bfetch\b/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bDeno\b/, /\bprocess\b/, /\bBuffer\b/, /\bDate\b/, /Math\.random/,
    /\bcrypto\b/, /\bperformance\b/, /\bsetTimeout\b/, /\bsetInterval\b/, /\beval\b/, /\bFunction\s*\(/, /\bglobalThis\b/,
    /\bwindow\b/, /\bdocument\b/, /\blocalStorage\b/, /readFile|writeFile|readText|writeText/, /\bnavigator\b/, /\bIntl\b/,
    /toLocale/, /localeCompare/, /\bnew\s+Date\b/,
  ]) {
    assert.ok(!banned.test(code), "source does not use " + String(banned));
  }
  for (const name of ["renderTemplate", "assembleDocument", "isRenderedHeaderSafe"]) {
    assert.ok(new RegExp("export function " + name + "\\(").test(code), name + " is exported");
  }
});

test("digest of every output (compared across Deno and Node by the runner)", () => {
  console.log("INC3B_DIGEST " + digest.digest("hex"));
});
