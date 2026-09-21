import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOrbInline,
  parseOrbMarkdown,
  safeOrbHref,
} from "./orbMarkdownParser.js";

test("parses paragraphs, multiline content, strong and emphasis", () => {
  const blocks = parseOrbMarkdown(
    "Primer párrafo con **prioridad** y *contexto*.\nContinúa aquí.\n\nSegundo párrafo.",
  );
  assert.deepEqual(blocks.map((block) => block.type), ["paragraph", "paragraph"]);
  assert.deepEqual(
    blocks[0].content.map((node) => node.type),
    ["text", "strong", "text", "emphasis", "text"],
  );
  assert.equal(blocks[0].content[0].value.includes("Primer párrafo"), true);
});

test("parses compact H1, H2 and H3 headings", () => {
  const blocks = parseOrbMarkdown("# Visión\n## Prioridad\n### Siguiente paso");
  assert.deepEqual(blocks.map((block) => [block.type, block.level]), [
    ["heading", 1],
    ["heading", 2],
    ["heading", 3],
  ]);
});

test("parses unordered, ordered and nested lists", () => {
  const blocks = parseOrbMarkdown(
    "- Uno\n- Dos\n  - Dos A\n  - Dos B\n\n1. Primero\n2. Segundo",
  );
  assert.deepEqual(blocks.map((block) => block.type), [
    "unordered-list",
    "ordered-list",
  ]);
  assert.equal(blocks[0].items.length, 2);
  assert.equal(blocks[0].items[1].children[0].type, "unordered-list");
  assert.equal(blocks[0].items[1].children[0].items.length, 2);
});

test("parses safe links and rejects dangerous protocols", () => {
  assert.equal(safeOrbHref("https://orvesen.com"), "https://orvesen.com");
  assert.equal(safeOrbHref("mailto:equipo@orvesen.com"), "mailto:equipo@orvesen.com");
  assert.equal(safeOrbHref("javascript:alert(1)"), null);
  assert.equal(safeOrbHref("data:text/html,unsafe"), null);

  const safe = parseOrbInline("[ORVESEN](https://orvesen.com)");
  const unsafe = parseOrbInline("[Peligroso](javascript:alert(1))");
  assert.equal(safe[0].type, "link");
  assert.deepEqual(unsafe, [{ type: "text", value: "Peligroso" }]);
});

test("parses inline code, fenced code and blockquotes", () => {
  const blocks = parseOrbMarkdown(
    "> Una observación\n\nUsa `status`.\n\n```js\nconst active = true;\n```",
  );
  assert.deepEqual(blocks.map((block) => block.type), [
    "blockquote",
    "paragraph",
    "code-block",
  ]);
  assert.equal(blocks[1].content.some((node) => node.type === "code"), true);
  assert.equal(blocks[2].language, "js");
  assert.equal(blocks[2].value, "const active = true;");
});

test("keeps incomplete streaming markdown visible and stable", () => {
  const strong = parseOrbMarkdown("Orb está escribiendo **una prioridad");
  const code = parseOrbMarkdown("```js\nconst value = 1;");
  assert.equal(strong[0].type, "paragraph");
  assert.equal(strong[0].content.map((node) => node.value || "").join(""), "Orb está escribiendo **una prioridad");
  assert.equal(code[0].type, "code-block");
  assert.equal(code[0].value, "const value = 1;");
});

test("does not treat ordinary hash, asterisk or hyphen text as structure", () => {
  const blocks = parseOrbMarkdown(
    "Versión #2 mantiene 5 * 3 y el rango A-B sin convertirlos en Markdown.",
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(blocks[0].content.length, 1);
  assert.equal(blocks[0].content[0].type, "text");
});

test("leaves raw HTML as escaped React text data", () => {
  const blocks = parseOrbMarkdown("<script>alert('x')</script>");
  assert.deepEqual(blocks[0].content, [
    { type: "text", value: "<script>alert('x')</script>" },
  ]);
});
