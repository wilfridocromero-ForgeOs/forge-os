import assert from "node:assert/strict";
import {
  CHUNKER_VERSION,
  MAX_TOKENS,
  OVERLAP_TOKENS,
  TARGET_TOKENS,
  chunkKnowledgeText,
  lexicalTokens,
  normalizeKnowledgeText,
} from "./chunker.ts";

const shortText = "# Fundación\n\nORVESEN conserva evidencia verificable.\n\n- Punto uno\n- Punto dos";
const first = await chunkKnowledgeText(shortText);
const second = await chunkKnowledgeText(shortText);

assert.equal(CHUNKER_VERSION, "orvesen-hierarchical-v1");
assert.deepEqual(first, second, "same input and chunker version must be deterministic");
assert.equal(first.length, 1);
assert.deepEqual(first[0].heading_path, ["Fundación"]);
assert.match(first[0].content_hash, /^[0-9a-f]{64}$/);
assert.ok(first[0].content.includes("- Punto uno\n- Punto dos"), "short lists stay intact");

const longSection = `# Uno\n\n${Array.from({ length: 1000 }, (_, index) => `palabra${index}`).join(" ")}`;
const nextSection = "\n\n# Dos\n\nContenido independiente de la segunda sección.";
const longChunks = await chunkKnowledgeText(longSection + nextSection);
assert.ok(longChunks.length >= 3);
assert.ok(longChunks.every((chunk) => chunk.token_count <= MAX_TOKENS));
assert.ok(longChunks.every((chunk) => chunk.content_hash.length === 64));
assert.deepEqual(longChunks.map((chunk) => chunk.chunk_index), longChunks.map((_, index) => index));
assert.ok(longChunks.every((chunk) => chunk.token_count === lexicalTokens(chunk.content).length));

const firstSectionChunks = longChunks.filter((chunk) => chunk.heading_path.at(-1) === "Uno");
assert.ok(firstSectionChunks.length >= 2, "oversized blocks are divided");
assert.ok(
  firstSectionChunks.slice(0, -1).every(
    (chunk) => chunk.token_count >= TARGET_TOKENS && chunk.token_count <= TARGET_TOKENS + 16,
  ),
  "non-terminal oversized windows stay near the 450-token target",
);

const secondHeadingOffset = normalizeKnowledgeText(longSection + nextSection).indexOf("# Dos");
const secondSectionChunk = longChunks.find((chunk) => chunk.heading_path.at(-1) === "Dos");
assert.ok(secondSectionChunk);
assert.ok(
  secondSectionChunk.source_start >= secondHeadingOffset,
  "overlap must not cross a section boundary",
);

for (let index = 1; index < longChunks.length; index += 1) {
  const previous = longChunks[index - 1];
  const current = longChunks[index];
  if (previous.heading_path.join("/") !== current.heading_path.join("/")) continue;
  const overlapText = normalizeKnowledgeText(longSection + nextSection).slice(
    current.source_start,
    Math.min(previous.source_end, current.source_end),
  );
  assert.ok(lexicalTokens(overlapText).length <= OVERLAP_TOKENS);
}

const plainTitle = await chunkKnowledgeText("Título con capitalización normal\n\nContenido sin señal explícita.");
assert.deepEqual(plainTitle[0].heading_path, [], "plain lines are not invented as headings");

await assert.rejects(() => chunkKnowledgeText(" \n\0\t "), /empty after normalization/);

console.log(`chunker tests passed: ${first.length + longChunks.length} chunks inspected`);
