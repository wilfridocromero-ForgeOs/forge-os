import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const migration = fs.readFileSync(new URL("../../../supabase/migrations/20260830033635_lock_discovery_template_division_scope.sql", import.meta.url), "utf8");
const builder = fs.readFileSync(new URL("../../app/Discovery.jsx", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("./services/discoveryBuilderService.js", import.meta.url), "utf8");

test("templates with assessments lock destructive division changes in the database", () => {
  assert.match(migration, /before update of division_id on public\.discovery_templates/i);
  assert.match(migration, /assessment\.discovery_template_id = old\.id/i);
  assert.match(migration, /DISCOVERY_TEMPLATE_DIVISION_LOCKED/);
});

test("unchanged divisions and unused templates remain editable", () => {
  assert.match(migration, /new\.division_id is not distinct from old\.division_id/i);
  assert.match(migration, /if exists[\s\S]*raise exception[\s\S]*end if;[\s\S]*return new;/i);
});

test("the builder reports template usage and disables the division field", () => {
  assert.match(service, /has_assessments:\s*usedTemplateIds\.has\(template\.id\)/);
  assert.match(builder, /disabled=\{divisionLocked\}/);
  assert.match(builder, /Duplica la plantilla o crea una nueva versi[oó]n/);
});
