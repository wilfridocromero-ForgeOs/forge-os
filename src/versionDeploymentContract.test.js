import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("deployment cache policy revalidates documents and preserves immutable hashed assets", () => {
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  const headers = new Map(config.headers.map((entry) => [entry.source, entry.headers[0].value]));
  assert.equal(headers.get("/(.*)"), "no-cache, max-age=0, must-revalidate");
  assert.equal(headers.get("/version.json"), "no-store");
  assert.equal(headers.get("/sw.js"), "no-cache, no-store, must-revalidate");
  assert.equal(headers.get("/update-bootstrap.js"), "no-cache, no-store, must-revalidate");
  assert.equal(headers.get("/assets/(.*)"), "public, max-age=31536000, immutable");
});

test("push service worker owns no application shell cache or update reload", () => {
  const source = fs.readFileSync("public/sw.js", "utf8");
  assert.doesNotMatch(source, /addEventListener\(["']fetch/);
  assert.doesNotMatch(source, /caches\.(open|delete)|controllerchange|location\.reload/);
  assert.match(source, /addEventListener\(["']push/);
});

test("asset recovery performs one cache-busted navigation and preserves route/auth", () => {
  const listeners = new Map();
  const values = new Map([["supabase.auth.token", "preserved"]]);
  const navigations = [];
  const window = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    location: {
      origin: "https://app.orvesen.com",
      pathname: "/proyectos/123",
      search: "?tab=work",
      hash: "#task",
      replace(url) { navigations.push(url); },
    },
    sessionStorage: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, value); },
    },
  };
  vm.runInNewContext(fs.readFileSync("public/update-bootstrap.js", "utf8"), {
    window,
    URL,
    Date: { now: () => 5000 },
    JSON,
    Object,
    String,
    Number,
  });
  const event = { preventDefault() {} };
  listeners.get("vite:preloadError")(event);
  listeners.get("vite:preloadError")(event);
  assert.equal(navigations.length, 1);
  assert.match(navigations[0], /_asset_recovery=5000/);
  assert.equal(JSON.parse(values.get("orvesen-asset-recovery-attempt")).returnTo, "/proyectos/123?tab=work#task");
  assert.equal(values.get("supabase.auth.token"), "preserved");
});

test("source index installs asset recovery before the application entry", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.indexOf("/update-bootstrap.js") < html.indexOf("/src/main.jsx"));
});

test("production index keeps asset recovery before the hashed application entry", () => {
  const html = fs.readFileSync("dist/index.html", "utf8");
  assert.ok(html.indexOf("/update-bootstrap.js") < html.indexOf("/assets/"));
});

test("version guard installation is globally idempotent and cleanup is symmetrical", () => {
  const source = fs.readFileSync("src/versionGuard.js", "utf8");
  assert.match(source, /if \(!import\.meta\.env\.PROD \|\| installed \|\| !CURRENT_BUILD\)/);
  assert.match(source, /installed = true/);
  assert.match(source, /installed = false/);
  for (const event of ["focus", "online", "pageshow", "visibilitychange"]) {
    assert.match(source, new RegExp(`addEventListener\\(\\"${event}\\"`));
    assert.match(source, new RegExp(`removeEventListener\\(\\"${event}\\"`));
  }
  assert.match(source, /channel\?\.close\(\)/);
});

test("version diagnostics extend the debug API without changing the update latch", () => {
  const guard = fs.readFileSync("src/versionGuard.js", "utf8");
  const core = fs.readFileSync("src/versionUpdateCore.js", "utf8");
  assert.match(guard, /snapshot: \(\) => lastDiagnostic/);
  assert.match(guard, /history: \(\) => diagnosticHistory\?\.history\(\)/);
  assert.match(guard, /clearHistory: \(\) => diagnosticHistory\?\.clear\(\)/);
  assert.match(core, /decision\.status === "current" && state\.status !== "update_available"/);
  assert.match(core, /decision\.status === "stale" && state\.status !== "update_available"/);
});

test("build configuration reuses one canonical timestamp for runtime and manifest", () => {
  const source = fs.readFileSync("vite.config.js", "utf8");
  assert.equal((source.match(/Date\.now\(\)/g) || []).length, 1);
  assert.match(source, /local-\$\{appBuildTime\}/);
  assert.match(source, /built_at: appBuildTime/);
  assert.match(source, /VITE_APP_BUILD_TIME[^\n]+appBuildTime/);
});
