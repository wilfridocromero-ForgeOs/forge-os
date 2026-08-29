import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orbSource = readFileSync(new URL("../../app/Orb.jsx", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("../../services/OrbService.js", import.meta.url), "utf8");

test("terminal errors leave thinking state and render the existing safe failure", () => {
  const errorBranch = orbSource.match(/if \(type === "error"\) \{[\s\S]*?\n\s{8}\}/)?.[0] || "";
  assert.match(errorBranch, /failAssistantStream/);
  assert.doesNotMatch(errorBranch, /throw/);
  assert.match(orbSource, /finally \{ requestController\.current = null; setSending\(false\); \}/);
  assert.match(orbSource, /message\.displayStatus === "failed"/);
  assert.match(orbSource, /La respuesta no pudo completarse\./);
});

test("service propagates one terminal error after the reader lifecycle ends", () => {
  assert.match(serviceSource, /await consumeOrbEventReader/);
  assert.match(serviceSource, /if \(terminal\.error\)/);
  assert.match(serviceSource, /friendlyError\(terminal\.error\.code\)/);
});

test("a persisted completed or failed assistant is reconciled once", () => {
  assert.match(orbSource, /\["completed", "failed"\]\.includes\(item\.displayStatus\)/);
  assert.match(orbSource, /if \(terminalAssistant\) setMessages\(normalized\)/);
});
