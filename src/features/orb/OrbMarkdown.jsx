import { Fragment } from "react";

import { parseOrbMarkdown } from "./orbMarkdownParser";

function renderInline(nodes, keyPrefix) {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    if (node.type === "strong") {
      return <strong key={key}>{renderInline(node.children, key)}</strong>;
    }
    if (node.type === "emphasis") {
      return <em key={key}>{renderInline(node.children, key)}</em>;
    }
    if (node.type === "code") return <code key={key}>{node.value}</code>;
    if (node.type === "link") {
      return <a key={key} href={node.href} target="_blank" rel="noreferrer noopener">{renderInline(node.children, key)}</a>;
    }
    return <Fragment key={key}>{node.value}</Fragment>;
  });
}

function renderBlocks(blocks, keyPrefix = "orb") {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${block.type}-${index}`;
    if (block.type === "heading") {
      const Heading = `h${block.level}`;
      return <Heading key={key}>{renderInline(block.content, key)}</Heading>;
    }
    if (block.type === "code-block") {
      return <pre key={key} data-language={block.language || undefined}><code>{block.value}</code></pre>;
    }
    if (block.type === "blockquote") {
      return <blockquote key={key}>{renderBlocks(block.children, key)}</blockquote>;
    }
    if (block.type === "ordered-list" || block.type === "unordered-list") {
      const List = block.type === "ordered-list" ? "ol" : "ul";
      return <List key={key}>{block.items.map((item, itemIndex) => {
        const itemKey = `${key}-item-${itemIndex}`;
        return <li key={itemKey}><span>{renderInline(item.content, itemKey)}</span>{renderBlocks(item.children, itemKey)}</li>;
      })}</List>;
    }
    return <p key={key}>{renderInline(block.content, key)}</p>;
  });
}

export default function OrbMarkdown({ children }) {
  return renderBlocks(parseOrbMarkdown(children));
}
