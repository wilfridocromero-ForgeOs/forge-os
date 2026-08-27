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
