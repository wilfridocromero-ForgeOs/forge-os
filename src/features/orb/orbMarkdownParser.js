const BLOCK_START = /^(?:#{1,3}\s+|```|>\s?|\s*(?:[-+*]|\d+[.)])\s+)/;

export function safeOrbHref(value) {
  try {
    const url = new URL(value, "https://orvesen.invalid");
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? value
      : null;
  } catch {
    return null;
  }
}

function textNode(value) {
  return { type: "text", value };
}

function findLinkEnd(source, startIndex) {
  let nested = 0;
  for (let index = startIndex; index < source.length; index += 1) {
    if (source[index] === "(") nested += 1;
    if (source[index] !== ")") continue;
    if (nested === 0) return index;
    nested -= 1;
  }
  return -1;
}

export function parseOrbInline(value) {
  const source = String(value || "");
  const nodes = [];
  let plain = "";
  let index = 0;

  const flushPlain = () => {
    if (plain) nodes.push(textNode(plain));
    plain = "";
  };

  while (index < source.length) {
    if (source[index] === "`") {
      const end = source.indexOf("`", index + 1);
      if (end > index + 1) {
        flushPlain();
        nodes.push({ type: "code", value: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    if (source.startsWith("**", index)) {
      const end = source.indexOf("**", index + 2);
      if (end > index + 2) {
        flushPlain();
        nodes.push({
          type: "strong",
          children: parseOrbInline(source.slice(index + 2, end)),
        });
        index = end + 2;
        continue;
      }
    }

    if (source[index] === "*") {
      const end = source.indexOf("*", index + 1);
      if (end > index + 1) {
        flushPlain();
        nodes.push({
          type: "emphasis",
          children: parseOrbInline(source.slice(index + 1, end)),
        });
        index = end + 1;
        continue;
      }
    }

    if (source[index] === "[") {
      const labelEnd = source.indexOf("](", index + 1);
      const hrefEnd = labelEnd >= 0
        ? findLinkEnd(source, labelEnd + 2)
        : -1;
      if (labelEnd > index + 1 && hrefEnd > labelEnd + 2) {
        const label = source.slice(index + 1, labelEnd);
        const href = safeOrbHref(source.slice(labelEnd + 2, hrefEnd));
        flushPlain();
        nodes.push(href
          ? { type: "link", href, children: parseOrbInline(label) }
          : textNode(label));
        index = hrefEnd + 1;
        continue;
      }
    }

    plain += source[index];
    index += 1;
  }

  flushPlain();
  return nodes;
}

function listMatch(line) {
  const match = line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/);
  if (!match) return null;
  return {
    indent: match[1].replace(/\t/g, "  ").length,
    ordered: /^\d/.test(match[2]),
    content: match[3],
  };
}

function parseList(lines, startIndex, baseIndent) {
  const first = listMatch(lines[startIndex]);
  const list = { type: first.ordered ? "ordered-list" : "unordered-list", items: [] };
  let index = startIndex;

  while (index < lines.length) {
    const current = listMatch(lines[index]);
    if (!current || current.indent < baseIndent) break;

    if (current.indent > baseIndent) {
      const parent = list.items.at(-1);
      if (!parent) break;
      const nested = parseList(lines, index, current.indent);
      parent.children.push(nested.block);
      index = nested.nextIndex;
      continue;
    }

    const expectedOrdered = list.type === "ordered-list";
    if (current.ordered !== expectedOrdered) break;
    list.items.push({
      content: parseOrbInline(current.content),
      children: [],
    });
    index += 1;
  }

  return { block: list, nextIndex: index };
}

export function parseOrbMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code-block", language, value: codeLines.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        content: parseOrbInline(heading[2]),
      });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", children: parseOrbMarkdown(quoteLines.join("\n")) });
      continue;
    }

    const list = listMatch(line);
    if (list) {
      const parsed = parseList(lines, index, list.indent);
      blocks.push(parsed.block);
      index = parsed.nextIndex;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !BLOCK_START.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({
      type: "paragraph",
      content: parseOrbInline(paragraph.join("\n")),
    });
  }

  return blocks;
}
