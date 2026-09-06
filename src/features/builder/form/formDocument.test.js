import assert from "node:assert/strict";
import test from "node:test";
import { createFormDocument, createFormField, FORM_FIELD_TYPES, resolveFormStyle, validateFormDocument } from "./formDocument.js";

test("forms default to a readable visual surface independent from the landing theme", () => {
  const document = createFormDocument();
  const style = resolveFormStyle(document.settings);
  assert.equal(style.inherit_page_theme, false);
  assert.equal(style.style_preset, "clean_light");
  assert.equal(style.card_background, "#ffffff");
  assert.equal(validateFormDocument(document).valid, true);
});

test("Form Builder supports the professional V1 field catalog", () => {
  assert.deepEqual(
    FORM_FIELD_TYPES.map(({ type }) => type),
    ["text", "email", "tel", "textarea", "select", "checkbox", "radio", "number", "url"],
  );
});

test("radio fields receive options and validate like select fields", () => {
  const field = createFormField("radio");
  const result = validateFormDocument({
    schema_version: 1,
    document_type: "form",
    settings: {},
    fields: [field],
  });
  assert.equal(result.valid, true);
  assert.equal(field.options.length, 3);
});
