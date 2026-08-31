import assert from "node:assert/strict";
import test from "node:test";

import { parseOrbMarkdown } from "./orbMarkdownParser.js";

function ordered(markdown) {
  const blocks = parseOrbMarkdown(markdown);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "ordered-list");
  return blocks[0];
}

test("repeated Markdown markers remain one sequential ordered list", () => {
  assert.equal(ordered("1. Primero\n1. Segundo\n1. Tercero").items.length, 3);
});

test("explicit sequential markers remain one ordered list", () => {
  assert.equal(ordered("1. Primero\n2. Segundo\n3. Tercero").items.length, 3);
});

test("loose ordered items do not reset into separate lists", () => {
  const list = ordered(
    "1. **Primero**\n\n1. **Segundo**\n\n1. **Tercero**",
  );
  assert.equal(list.items.length, 3);
  assert.equal(list.items.every((item) => item.content[0].type === "strong"), true);
});

test("bulleted lists remain unaffected", () => {
  const blocks = parseOrbMarkdown("- Primero\n\n- Segundo\n\n- Tercero");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "unordered-list");
  assert.equal(blocks[0].items.length, 3);
});

test("partial streaming content settles into one completed ordered list", () => {
  const partial = parseOrbMarkdown("1. Primero\n\n1.");
  assert.equal(partial[0].type, "ordered-list");
  const completed = ordered("1. Primero\n\n1. Segundo\n\n1. Tercero");
  assert.equal(completed.items.length, 3);
});
