// ORVESEN Email Marketing V1 - Increment 3b: email-content.v1 renderer.
//
// Normative contract: docs/email-marketing/EMAIL_CONTENT_V1_CONTRACT.md
// (section 7 for renderTemplate, section 9 for assembleDocument). This module
// consumes that contract; it never defines its own rules.
//
// Pure and deterministic: no imports, no I/O, no network, no database, no
// clock, no randomness, no environment. The same input always produces the
// same bytes on Deno and Node. Stored template versions are already valid
// (PostgreSQL is the authority): they are not revalidated here, except where
// section 7.2 requires it (URLs are re-checked; a block whose URL fails is not
// rendered).

// ---------------------------------------------------------------------------
// Types

export type MergeValues = {
  contact?: { first_name?: unknown; last_name?: unknown; email?: unknown } | null;
  organization?: { name?: unknown } | null;
  custom?: Record<string, unknown> | null;
  archived_custom?: readonly string[] | null;
};

export type TemplateVersion = {
  subject: string;
  preheader: string | null;
  content: { version: string; blocks: readonly unknown[] };
};

export type RenderedImage = {
  type: "image";
  src: string;
  alt: string;
  href: string | null;
  width: number | null;
  src_attr: string;
  alt_attr: string;
  href_attr?: string;
};

export type RenderedBlock =
  | { type: "heading"; level: number; text: string; html: string }
  | { type: "paragraph"; text: string; html: string }
  | { type: "button"; text: string; url: string; html: string; href_attr: string }
  | RenderedImage
  | { type: "divider" }
  | { type: "spacer"; height: number };

export type RenderFailureCode =
  | "RENDER_EMPTY_SUBJECT"
  | "RENDER_UNSAFE_HEADER"
  | "RENDER_FIELD_TOO_LONG"
  | "RENDER_EMPTY_BODY";

export type RenderSuccess = {
  ok: true;
  subject: string;
  preheader: string | null;
  preheader_html: string | null;
  blocks: RenderedBlock[];
};

export type RenderFailure =
  | { ok: false; error: "RENDER_EMPTY_SUBJECT" }
  | { ok: false; error: "RENDER_EMPTY_BODY" }
  | { ok: false; error: "RENDER_UNSAFE_HEADER"; location: string }
  | { ok: false; error: "RENDER_FIELD_TOO_LONG"; location: string };

export type RenderResult = RenderSuccess | RenderFailure;

export type Footer = {
  version: "email-footer.v1";
  organization_name: string;
  unsubscribe_label: string;
  unsubscribe_url: string;
  notice?: string | null;
};

export type DocumentSuccess = { ok: true; html: string; text: string };
export type DocumentFailure =
  | { ok: false; error: "DOCUMENT_RENDER_INVALID"; reason: string }
  | { ok: false; error: "DOCUMENT_FOOTER_REQUIRED" }
  | { ok: false; error: "DOCUMENT_FOOTER_INVALID"; field: string; reason: string };
export type DocumentResult = DocumentSuccess | DocumentFailure;

// Thrown (never returned) when renderTemplate receives input that no stored
// version can be (contract section 9.4): a caller error, not a per-contact
// render failure.
export class EmailRenderInputError extends Error {
  readonly code = "RENDER_INPUT_INVALID";
  constructor(reason: string) {
    super("RENDER_INPUT_INVALID: " + reason);
    this.name = "EmailRenderInputError";
  }
}

// ---------------------------------------------------------------------------
// Character sets (contract section 3; identical to
// private.email_text_has_unsafe_chars and email_text_has_header_unsafe_chars).

const GENERAL_SET =
  "\\u0001-\\u001F\\u007F-\\u009F\\u00AD\\u034F\\u061C\\u115F-\\u1160\\u17B4-\\u17B5\\u180B-\\u180F" +
  "\\u200B\\u200E-\\u200F\\u2028-\\u202E\\u2060-\\u206F\\u2800\\u3164\\uFEFF\\uFFA0\\uFFF0-\\uFFFB" +
  "\\u{1BCA0}-\\u{1BCA3}\\u{1D173}-\\u{1D17A}\\u{E0000}-\\u{E00FF}\\u{E01F0}-\\u{E0FFF}";
const HEADER_ONLY_SET = "\\u{E0100}-\\u{E01EF}";

const GENERAL_ANY = new RegExp("[" + GENERAL_SET + "]", "u");
const GENERAL_ALL = new RegExp("[" + GENERAL_SET + "]", "gu");
const GENERAL_ANY_EXCEPT_LF = new RegExp("[" + GENERAL_SET.replace("\\u0001-\\u001F", "\\u0001-\\u0009\\u000B-\\u001F") + "]", "u");
const HEADER_ONLY_ANY = new RegExp("[" + HEADER_ONLY_SET + "]", "u");
// U+0000 and unpaired surrogates cannot come from PostgreSQL (section 9.5).
const OUTSIDE_SQL_ANY = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const OUTSIDE_SQL_ALL = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// ---------------------------------------------------------------------------
// Small helpers

function codePoints(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

function isBlank(value: string, allowNewline: boolean): boolean {
  for (const ch of value) {
    if (ch === " ") continue;
    if (allowNewline && ch === "\n") continue;
    return false;
  }
  return true;
}

function trimSpaces(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === 0x20) start += 1;
  while (end > start && value.charCodeAt(end - 1) === 0x20) end -= 1;
  return value.slice(start, end);
}

// ---------------------------------------------------------------------------
// Header safety: mirror of private.email_rendered_header_is_safe.

export function isRenderedHeaderSafe(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (OUTSIDE_SQL_ANY.test(value)) return false;
  if (GENERAL_ANY.test(value)) return false;
  if (HEADER_ONLY_ANY.test(value)) return false;
  return value.indexOf("=?") === -1;
}

// ---------------------------------------------------------------------------
// URLs (contract section 6; mirror of private.email_url_is_allowed).

const HTTPS_URL =
  /^https:\/\/([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$/;
const MAILBOX = /^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$/;
const NORMALIZED_ADDRESS = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+@[a-z0-9.-]+$/;
const NORMALIZED_DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

// Mirror of private.email_normalize_address for the mailbox of a mailto: URL
// (already restricted to ASCII by MAILBOX, so lower-casing is locale-free).
function normalizesAsAddress(mailbox: string): boolean {
  const candidate = mailbox.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "").toLowerCase();
  if (candidate === "" || codePoints(candidate) > 254) return false;
  if (!NORMALIZED_ADDRESS.test(candidate)) return false;
  const at = candidate.indexOf("@");
  const local = candidate.slice(0, at);
  const rest = candidate.slice(at + 1);
  const domain = rest.indexOf("@") === -1 ? rest : rest.slice(0, rest.indexOf("@"));
  if (local.length < 1 || local.length > 64) return false;
  if (local.startsWith(".") || local.endsWith(".") || local.indexOf("..") !== -1) return false;
  if (domain.length > 253 || !NORMALIZED_DOMAIN.test(domain)) return false;
  return true;
}

export function isUrlAllowed(url: unknown, allowMailto: boolean): boolean {
  if (typeof url !== "string") return false;
  const length = codePoints(url);
  if (length < 1 || length > 2048) return false;
  if (url.startsWith("https://")) return HTTPS_URL.test(url);
  if (allowMailto && url.startsWith("mailto:")) {
    const mailbox = url.slice(7);
    return MAILBOX.test(mailbox) && normalizesAsAddress(mailbox);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Escaping (contract section 7.2). Attribute values use the same escape and are
// always emitted inside double quotes.

export function escapeHtml(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === "\"") out += "&quot;";
    else if (ch === "'") out += "&#39;";
    else out += ch;
  }
  return out;
}

export function escapeMultiline(value: string): string {
  return escapeHtml(value).split("\n").join("<br>");
}

// ---------------------------------------------------------------------------
// Value normalization (contract section 7.1 step 2), exact order.

export function normalizeValue(value: string, multiline: boolean): string {
  // 2.1 line breaks: CRLF, lone CR, NEL, LINE SEPARATOR, PARAGRAPH SEPARATOR -> LF.
  let text = value.replace(/\r\n/g, "\n").replace(/[\r\u0085\u{2028}\u{2029}]/gu, "\n");
  // 2.2 TAB -> space.
  text = text.replace(/\t/g, " ");
  // 2.3 remove the rest of the general forbidden set except LF (plus the
  // TS-only section 9.5 characters). Ideographic variation selectors are kept.
  text = text.replace(OUTSIDE_SQL_ALL, "");
  text = text.replace(GENERAL_ALL, (ch) => (ch === "\n" ? ch : ""));
  // 2.4 single-line fields: each LF becomes a space.
  if (!multiline) text = text.replace(/\n/g, " ");
  return text;
}

// ---------------------------------------------------------------------------
// Merge tags (contract section 5).

const CANDIDATE = /\{\{([^{}]*)\}\}/g;
const TAG = /^ *([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*) *(\|([\s\S]*))?$/;

function lookup(values: MergeValues, path: string): unknown {
  const dot = path.indexOf(".");
  const scope = path.slice(0, dot);
  const key = path.slice(dot + 1);
  if (scope === "contact") {
    const contact = values.contact;
    if (contact === null || typeof contact !== "object") return null;
    if (key === "first_name") return contact.first_name;
    if (key === "last_name") return contact.last_name;
    if (key === "email") return contact.email;
    return null;
  }
  if (scope === "organization") {
    const organization = values.organization;
    if (organization === null || typeof organization !== "object" || key !== "name") return null;
    return organization.name;
  }
  if (scope === "custom") {
    const archived = Array.isArray(values.archived_custom) ? values.archived_custom : [];
    if (archived.indexOf(key) !== -1) return null;
    const custom = values.custom;
    if (custom === null || typeof custom !== "object") return null;
    return Object.prototype.hasOwnProperty.call(custom, key) ? custom[key] : null;
  }
  return null;
}

// Steps 1-3: resolve, normalize each value, substitute. A single left-to-right
// pass over the template text: substituted values are never scanned again.
function substitute(template: string, values: MergeValues, multiline: boolean): string {
  return template.replace(CANDIDATE, (_match: string, inner: string) => {
    const parts = TAG.exec(inner);
    if (parts === null) return "";
    const raw = lookup(values, parts[1]);
    if (typeof raw === "string") {
      const normalized = normalizeValue(raw, multiline);
      if (!isBlank(normalized, multiline)) return normalized;
    }
    if (parts[3] === undefined) return "";
    const fallback = normalizeValue(trimSpaces(parts[3]), multiline);
    return isBlank(fallback, multiline) ? "" : fallback;
  });
}

// ---------------------------------------------------------------------------
// renderTemplate (contract section 7.1 / 9.1)

const LIMITS = { subject: 400, preheader: 500, heading: 1000, button: 200, paragraph: 20000 };

type FieldOutcome =
  | { kind: "empty" }
  | { kind: "ok"; text: string }
  | { kind: "fail"; failure: RenderFailure };

// Step 4 for one assembled field. Order inside a field: empty -> unsafe header -> length.
function finishField(
  assembled: string,
  field: "subject" | "preheader" | "heading" | "button" | "paragraph",
  location: string,
): FieldOutcome {
  let text = assembled;
  const header = field === "subject" || field === "preheader";
  if (header) text = text.split("=?").join("= ?");
  if (field !== "paragraph") text = trimSpaces(text);
  if (isBlank(text, true)) return { kind: "empty" };
  if (header && !isRenderedHeaderSafe(text)) {
    return { kind: "fail", failure: { ok: false, error: "RENDER_UNSAFE_HEADER", location } };
  }
  if (codePoints(text) > LIMITS[field]) {
    return { kind: "fail", failure: { ok: false, error: "RENDER_FIELD_TOO_LONG", location } };
  }
  return { kind: "ok", text };
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== "string") throw new EmailRenderInputError(what + " must be a string");
  return value;
}

function requireInteger(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new EmailRenderInputError(what + " must be an integer");
  return value;
}

export function renderTemplate(version: TemplateVersion, resolvedValues: MergeValues): RenderResult {
  if (version === null || typeof version !== "object") throw new EmailRenderInputError("version must be an object");
  if (resolvedValues === null || typeof resolvedValues !== "object") throw new EmailRenderInputError("values must be an object");
  const subjectTemplate = requireString(version.subject, "subject");
  const preheaderTemplate = version.preheader === null ? null : requireString(version.preheader, "preheader");
  const content = version.content;
  if (content === null || typeof content !== "object" || content.version !== "email-content.v1" || !Array.isArray(content.blocks)) {
    throw new EmailRenderInputError("content must be email-content.v1");
  }

  // Fields in order: subject -> preheader -> blocks; EMPTY_BODY last.
  const subject = finishField(substitute(subjectTemplate, resolvedValues, false), "subject", "subject");
  if (subject.kind === "fail") return subject.failure;
  if (subject.kind === "empty") return { ok: false, error: "RENDER_EMPTY_SUBJECT" };

  let preheader: string | null = null;
  if (preheaderTemplate !== null) {
    const outcome = finishField(substitute(preheaderTemplate, resolvedValues, false), "preheader", "preheader");
    if (outcome.kind === "fail") return outcome.failure;
    if (outcome.kind === "ok") preheader = outcome.text;
  }

  const blocks: RenderedBlock[] = [];
  let contentBlocks = 0;
  for (let index = 0; index < content.blocks.length; index += 1) {
    const block = content.blocks[index] as Record<string, unknown>;
    if (block === null || typeof block !== "object") throw new EmailRenderInputError("block must be an object");
    const location = "block " + String(index + 1);
    const type = block.type;
    if (type === "heading" || type === "paragraph" || type === "button") {
      const multiline = type === "paragraph";
      const outcome = finishField(substitute(requireString(block.text, location + " text"), resolvedValues, multiline), type, location);
      if (outcome.kind === "fail") return outcome.failure;
      if (outcome.kind === "empty") continue;
      if (type === "heading") {
        const level = requireInteger(block.level, location + " level");
        blocks.push({ type: "heading", level, text: outcome.text, html: escapeHtml(outcome.text) });
      } else if (type === "paragraph") {
        blocks.push({ type: "paragraph", text: outcome.text, html: escapeMultiline(outcome.text) });
      } else {
        const url = requireString(block.url, location + " url");
        if (!isUrlAllowed(url, true)) continue;
        blocks.push({ type: "button", text: outcome.text, url, html: escapeHtml(outcome.text), href_attr: escapeHtml(url) });
      }
      contentBlocks += 1;
    } else if (type === "image") {
      const src = requireString(block.src, location + " src");
      const alt = requireString(block.alt, location + " alt");
      const href = block.href === undefined || block.href === null ? null : requireString(block.href, location + " href");
      const width = block.width === undefined || block.width === null ? null : requireInteger(block.width, location + " width");
      if (!isUrlAllowed(src, false) || (href !== null && !isUrlAllowed(href, true))) continue;
      const image: RenderedImage = {
        type: "image",
        src,
        alt,
        href,
        width,
        src_attr: escapeHtml(src),
        alt_attr: escapeHtml(alt),
      };
      if (href !== null) image.href_attr = escapeHtml(href);
      blocks.push(image);
      contentBlocks += 1;
    } else if (type === "divider") {
      blocks.push({ type: "divider" });
    } else if (type === "spacer") {
      blocks.push({ type: "spacer", height: requireInteger(block.height, location + " height") });
    } else {
      throw new EmailRenderInputError(location + " has an unknown type");
    }
  }
  if (contentBlocks === 0) return { ok: false, error: "RENDER_EMPTY_BODY" };

  return {
    ok: true,
    subject: subject.text,
    preheader,
    preheader_html: preheader === null ? null : escapeHtml(preheader),
    blocks,
  };
}

// ---------------------------------------------------------------------------
// assembleDocument (contract section 9.2 - 9.4)

const FOOTER_KEYS = ["version", "organization_name", "unsubscribe_label", "unsubscribe_url", "notice"];

function textProblem(value: unknown, maxLength: number, multiline: boolean): string | null {
  if (typeof value !== "string") return "not a string";
  const length = codePoints(value);
  if (length < 1) return "required";
  if (length > maxLength) return "too long";
  if (isBlank(value, multiline)) return "blank";
  if (OUTSIDE_SQL_ANY.test(value)) return "forbidden characters";
  if ((multiline ? GENERAL_ANY_EXCEPT_LF : GENERAL_ANY).test(value)) return "forbidden characters";
  return null;
}

function footerProblem(footer: Record<string, unknown>): { field: string; reason: string } | null {
  for (const key of Object.keys(footer)) {
    if (FOOTER_KEYS.indexOf(key) === -1) return { field: "footer", reason: "unknown key: " + key };
  }
  if (footer.version !== "email-footer.v1") return { field: "version", reason: "unsupported version" };
  let reason = textProblem(footer.organization_name, 200, false);
  if (reason !== null) return { field: "organization_name", reason };
  reason = textProblem(footer.unsubscribe_label, 100, false);
  if (reason !== null) return { field: "unsubscribe_label", reason };
  if (typeof footer.unsubscribe_url !== "string" || !isUrlAllowed(footer.unsubscribe_url, false)) {
    return { field: "unsubscribe_url", reason: "invalid url" };
  }
  if (footer.notice !== undefined && footer.notice !== null) {
    reason = textProblem(footer.notice, 1000, true);
    if (reason !== null) return { field: "notice", reason };
  }
  return null;
}

// Structural check of a renderTemplate success. Plain-text fields are the only
// ones used; html / *_attr fields are ignored and re-derived.
function renderedProblem(rendered: unknown): string | null {
  if (rendered === null || typeof rendered !== "object") return "not an object";
  const r = rendered as Record<string, unknown>;
  if (r.ok !== true) return "not a successful render";
  if (textProblem(r.subject, LIMITS.subject, false) !== null || !isRenderedHeaderSafe(r.subject)) return "invalid subject";
  if (r.preheader !== null && (textProblem(r.preheader, LIMITS.preheader, false) !== null || !isRenderedHeaderSafe(r.preheader))) {
    return "invalid preheader";
  }
  if (!Array.isArray(r.blocks)) return "blocks must be an array";
  let contentBlocks = 0;
  for (const item of r.blocks) {
    if (item === null || typeof item !== "object") return "invalid block";
    const b = item as Record<string, unknown>;
    if (b.type === "heading") {
      if (b.level !== 1 && b.level !== 2 && b.level !== 3) return "invalid heading level";
      if (textProblem(b.text, LIMITS.heading, false) !== null) return "invalid heading text";
    } else if (b.type === "paragraph") {
      if (textProblem(b.text, LIMITS.paragraph, true) !== null) return "invalid paragraph text";
    } else if (b.type === "button") {
      if (textProblem(b.text, LIMITS.button, false) !== null) return "invalid button text";
      if (!isUrlAllowed(b.url, true)) return "invalid button url";
    } else if (b.type === "image") {
      if (!isUrlAllowed(b.src, false)) return "invalid image src";
      if (typeof b.alt !== "string" || codePoints(b.alt) > 300 || OUTSIDE_SQL_ANY.test(b.alt) || GENERAL_ANY.test(b.alt)) {
        return "invalid image alt";
      }
      if (b.href !== null && !isUrlAllowed(b.href, true)) return "invalid image href";
      if (b.width !== null && (typeof b.width !== "number" || !Number.isInteger(b.width) || b.width < 1 || b.width > 600)) {
        return "invalid image width";
      }
    } else if (b.type === "divider") {
      continue;
    } else if (b.type === "spacer") {
      if (typeof b.height !== "number" || !Number.isInteger(b.height) || b.height < 4 || b.height > 96) return "invalid spacer height";
      continue;
    } else {
      return "unknown block type";
    }
    contentBlocks += 1;
  }
  if (contentBlocks === 0) return "no content blocks";
  return null;
}

function blockHtml(block: RenderedBlock): string {
  switch (block.type) {
    case "heading":
      return "<h" + String(block.level) + ">" + escapeHtml(block.text) + "</h" + String(block.level) + ">";
    case "paragraph":
      return "<p>" + escapeMultiline(block.text) + "</p>";
    case "button":
      return "<p><a href=\"" + escapeHtml(block.url) + "\">" + escapeHtml(block.text) + "</a></p>";
    case "image": {
      const width = block.width === null ? "" : " width=\"" + String(block.width) + "\"";
      const img = "<img src=\"" + escapeHtml(block.src) + "\" alt=\"" + escapeHtml(block.alt) + "\"" + width + ">";
      return block.href === null ? img : "<a href=\"" + escapeHtml(block.href) + "\">" + img + "</a>";
    }
    case "divider":
      return "<hr>";
    case "spacer":
      return "<div style=\"height:" + String(block.height) + "px\"></div>";
  }
}

function blockText(block: RenderedBlock): string | null {
  switch (block.type) {
    case "heading":
    case "paragraph":
      return block.text;
    case "button":
      return block.text + "\n" + block.url;
    case "image": {
      const lines: string[] = [];
      if (!isBlank(block.alt, false)) lines.push("[" + block.alt + "]");
      if (block.href !== null) lines.push(block.href);
      return lines.length === 0 ? null : lines.join("\n");
    }
    case "divider":
      return "---";
    case "spacer":
      return null;
  }
}

export function assembleDocument(rendered: RenderResult, footer: Footer | null | undefined): DocumentResult {
  const renderReason = renderedProblem(rendered);
  if (renderReason !== null) return { ok: false, error: "DOCUMENT_RENDER_INVALID", reason: renderReason };
  if (footer === null || footer === undefined) return { ok: false, error: "DOCUMENT_FOOTER_REQUIRED" };
  if (typeof footer !== "object" || Array.isArray(footer)) {
    return { ok: false, error: "DOCUMENT_FOOTER_INVALID", field: "footer", reason: "not an object" };
  }
  const problem = footerProblem(footer as unknown as Record<string, unknown>);
  if (problem !== null) return { ok: false, error: "DOCUMENT_FOOTER_INVALID", field: problem.field, reason: problem.reason };

  const r = rendered as RenderSuccess;
  const notice = footer.notice === undefined ? null : footer.notice;

  const html: string[] = [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>" + escapeHtml(r.subject) + "</title>",
    "</head>",
    "<body>",
  ];
  if (r.preheader !== null) {
    html.push("<div style=\"display:none;max-height:0;overflow:hidden;mso-hide:all\">" + escapeHtml(r.preheader) + "</div>");
  }
  for (const block of r.blocks) html.push(blockHtml(block));
  html.push("<div data-orvesen-footer=\"email-footer.v1\">");
  html.push("<hr>");
  html.push("<p>" + escapeHtml(footer.organization_name) + "</p>");
  if (notice !== null) html.push("<p>" + escapeMultiline(notice) + "</p>");
  html.push("<p><a href=\"" + escapeHtml(footer.unsubscribe_url) + "\">" + escapeHtml(footer.unsubscribe_label) + "</a></p>");
  html.push("</div>");
  html.push("</body>");
  html.push("</html>");

  const parts: string[] = [];
  for (const block of r.blocks) {
    const part = blockText(block);
    if (part !== null) parts.push(part);
  }
  const footerLines = ["-- ", footer.organization_name];
  if (notice !== null) footerLines.push(notice);
  footerLines.push(footer.unsubscribe_label + ": " + footer.unsubscribe_url);
  const body = parts.join("\n\n");
  const text = (body === "" ? "" : body + "\n\n") + footerLines.join("\n") + "\n";

  return { ok: true, html: html.join("\n") + "\n", text };
}
