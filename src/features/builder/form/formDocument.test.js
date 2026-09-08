import assert from "node:assert/strict";
import test from "node:test";
import { changeFormFieldType, createFormDocument, createFormField, createFormFieldId, FORM_FIELD_TYPES, resolveFormStyle, validateFormDocument } from "./formDocument.js";

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
  const document = createFormDocument();
  document.fields = [field];
  const result = validateFormDocument(document);
  assert.equal(result.valid, true);
  assert.equal(field.options.length, 3);
});

test("field type changes preserve valid backend option ownership", () => {
  const text = changeFormFieldType(createFormField("select"), "tel");
  assert.equal(Object.hasOwn(text, "options"), false);
  const radio = changeFormFieldType(text, "radio");
  assert.deepEqual(radio.options, ["Opción 1"]);
  const document = createFormDocument();
  document.fields = [radio];
  assert.equal(validateFormDocument(document).valid, true);
});

test("frontend rejects stale options on scalar fields like the SQL validator", () => {
  const document = createFormDocument();
  document.fields[0].options = ["stale"];
  const result = validateFormDocument(document);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Solo select y radio pueden contener opciones."));
});

test("field id fallback remains a SQL-valid UUID without randomUUID", () => {
  const id = createFormFieldId({});
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const document = createFormDocument();
  document.fields[0].id = id;
  assert.equal(validateFormDocument(document).valid, true);
});
