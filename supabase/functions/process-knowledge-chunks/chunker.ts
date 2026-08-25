export const CHUNKER_VERSION = "orvesen-hierarchical-v1";
export const TOKENIZER_VERSION = "orvesen-lexical-v1";
export const TARGET_TOKENS = 450;
export const MAX_TOKENS = 800;
export const MIN_TOKENS = 80;
export const OVERLAP_TOKENS = 60;

type Token = { start: number; end: number };
type Heading = { level: number; title: string };
type Block = {
  start: number;
  end: number;
  headingPath: string[];
  sectionKey: string;
};

export type KnowledgeChunk = {
  chunk_index: number;
  content: string;
  content_hash: string;
  token_count: number;
  heading_path: string[];
  source_start: number;
  source_end: number;
  metadata: Record<string, unknown>;
};

export function normalizeKnowledgeText(value: string) {
  return value
    .replaceAll("\0", "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/[ \u00a0]+$/gm, "")
    .trim();
}

export function lexicalTokens(value: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*|[^\s]/gu;
  for (const match of value.matchAll(pattern)) {
    const start = match.index;
    tokens.push({ start, end: start + match[0].length });
  }
  return tokens;
}

function inferHeading(value: string): Heading | null {
  const line = value.trim();
  if (!line || line.includes("\n") || line.length > 160) return null;

  const markdown = /^(#{1,6})\s+(.+)$/.exec(line);
  if (markdown) return { level: markdown[1].length, title: markdown[2].trim() };

  const numbered = /^(\d+(?:\.\d+)*\.?)[ \t]+(.+)$/.exec(line);
  if (numbered && lexicalTokens(numbered[2]).length <= 16) {
    const level = Math.min(6, numbered[1].replace(/\.$/, "").split(".").length);
    return { level, title: line };
  }

  const letters = [...line].filter((character) => /\p{L}/u.test(character));
  if (letters.length >= 4 && line === line.toLocaleUpperCase() && lexicalTokens(line).length <= 16) {
    return { level: 1, title: line };
  }

  return null;
}

function semanticBlocks(text: string): Block[] {
  const rawBlocks = [...text.matchAll(/\S(?:[\s\S]*?\S)?(?=\n[ \t]*\n|$)/g)];
  const headingStack: string[] = [];

  return rawBlocks.map((match) => {
    const start = match.index;
    const end = start + match[0].length;
    const heading = inferHeading(match[0]);
    if (heading) {
      headingStack.length = heading.level - 1;
      headingStack[heading.level - 1] = heading.title;
    }
    const headingPath = [...headingStack].filter(Boolean);
    return {
      start,
      end,
      headingPath,
      sectionKey: headingPath.join("\u001f"),
    };
  });
}

function tokenCount(text: string, start: number, end: number) {
  return lexicalTokens(text.slice(start, end)).length;
}

function overlapStart(text: string, start: number, end: number, maximumOverlap = OVERLAP_TOKENS) {
  if (maximumOverlap <= 0) return end;
  const tokens = lexicalTokens(text.slice(start, end));
  if (tokens.length <= maximumOverlap) return start;
  return start + tokens[tokens.length - maximumOverlap].start;
}

function splitOversizedBlock(text: string, block: Block) {
  const tokens = lexicalTokens(text.slice(block.start, block.end));
  const pieces: Block[] = [];
  let tokenStart = 0;

  while (tokenStart < tokens.length) {
    const tokenEnd = Math.min(tokens.length, tokenStart + TARGET_TOKENS);
    pieces.push({
      ...block,
      start: block.start + tokens[tokenStart].start,
      end: block.start + tokens[tokenEnd - 1].end,
    });
    if (tokenEnd === tokens.length) break;
    tokenStart = Math.max(tokenStart + 1, tokenEnd - OVERLAP_TOKENS);
  }

  return pieces;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function chunkKnowledgeText(value: string): Promise<KnowledgeChunk[]> {
  const text = normalizeKnowledgeText(value);
  if (!text) throw new Error("Extracted text is empty after normalization.");

  const blocks = semanticBlocks(text);
  if (!blocks.length) throw new Error("Extracted text contains no chunkable blocks.");

  const ranges: Block[] = [];
  let current: Block | null = null;
  let previous: Block | null = null;

  const flush = () => {
    if (!current) return;
    ranges.push(current);
    previous = current;
    current = null;
  };

  const beginBlock = (block: Block): Block => {
    const blockTokens = tokenCount(text, block.start, block.end);
    const availableOverlap = Math.max(0, MAX_TOKENS - blockTokens);
    if (previous && previous.sectionKey === block.sectionKey && availableOverlap > 0) {
      return {
        ...block,
        start: overlapStart(
          text,
          previous.start,
          previous.end,
          Math.min(OVERLAP_TOKENS, availableOverlap),
        ),
      };
    }
    return block;
  };

  for (const block of blocks) {
    const count = tokenCount(text, block.start, block.end);
    if (count > MAX_TOKENS) {
      const pieces = splitOversizedBlock(text, block);
      if (
        current
        && current.sectionKey === block.sectionKey
        && tokenCount(text, current.start, pieces[0].end) <= MAX_TOKENS
      ) {
        const combined = { ...current, end: pieces[0].end };
        ranges.push(combined);
        previous = combined;
        current = null;
        pieces.shift();
      } else {
        flush();
      }
      for (const piece of pieces) {
        ranges.push(piece);
        previous = piece;
      }
      continue;
    }

    if (!current) {
      current = beginBlock(block);
      continue;
    }

    const sameSection = current.sectionKey === block.sectionKey;
    const combinedCount = sameSection ? tokenCount(text, current.start, block.end) : MAX_TOKENS + 1;
    if (!sameSection || combinedCount > TARGET_TOKENS) {
      flush();
      current = beginBlock(block);
    } else {
      current.end = block.end;
    }
  }
  flush();

  const chunks: KnowledgeChunk[] = [];
  for (const [index, range] of ranges.entries()) {
    const content = text.slice(range.start, range.end).trim();
    const count = lexicalTokens(content).length;
    if (!content || count < 1 || count > MAX_TOKENS) {
      throw new Error(`Chunk ${index} violates the 1-${MAX_TOKENS} token contract.`);
    }
    chunks.push({
      chunk_index: index,
      content,
      content_hash: await sha256(content),
      token_count: count,
      heading_path: range.headingPath,
      source_start: range.start,
      source_end: range.end,
      metadata: {
        normalization: "normalized-text-v1",
        tokenizer: TOKENIZER_VERSION,
        target_tokens: TARGET_TOKENS,
        maximum_tokens: MAX_TOKENS,
        minimum_tokens: MIN_TOKENS,
        overlap_tokens: OVERLAP_TOKENS,
        source_coordinates: "normalized_extracted_text",
      },
    });
  }

  return chunks;
}
