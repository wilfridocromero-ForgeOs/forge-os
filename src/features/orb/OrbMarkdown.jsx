import { Fragment } from "react";

const inlinePattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

function safeHref(value) {
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function renderInline(text, keyPrefix) {
  return text.split(inlinePattern).filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = safeHref(link[2]);
      return href
        ? <a key={key} href={href} target="_blank" rel="noreferrer noopener">{link[1]}</a>
        : <Fragment key={key}>{link[1]}</Fragment>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function parseBlocks(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  let code = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  lines.forEach((line) => {
    if (line.startsWith("```")) {
      flushParagraph(); flushList();
      if (code) { blocks.push(code); code = null; }
      else code = { type: "code", language: line.slice(3).trim(), lines: [] };
      return;
    }
    if (code) { code.lines.push(line); return; }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const type = ordered ? "ordered-list" : "unordered-list";
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((ordered || unordered)[1]);
      return;
    }
    if (!line.trim()) { flushParagraph(); flushList(); return; }
    flushList(); paragraph.push(line);
  });
  flushParagraph(); flushList();
  if (code) blocks.push(code);
  return blocks;
}

export default function OrbMarkdown({ children }) {
  return parseBlocks(children).map((block, index) => {
    const key = `${block.type}-${index}`;
    if (block.type === "code") {
      return <pre key={key} data-language={block.language || undefined}><code>{block.lines.join("\n")}</code></pre>;
    }
    if (block.type === "ordered-list" || block.type === "unordered-list") {
      const List = block.type === "ordered-list" ? "ol" : "ul";
      return <List key={key}>{block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderInline(item, `${key}-${itemIndex}`)}</li>)}</List>;
    }
    return <p key={key}>{renderInline(block.text, key)}</p>;
  });
}
