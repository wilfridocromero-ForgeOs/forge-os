// Builder landing persistence â€” permanent server-validation fixture corpus.
//
// Purpose: one deterministic, auditable corpus of landing/form documents used by BOTH
//   * `landingServerValidationFixtures.test.js` (client verdicts, corpus determinism), and
//   * `scripts/builder-forward-migration-matrix.*` (server verdicts against a real Postgres).
//
// Every fixture is derived from the real client modules â€” `createLandingDocument`,
// `createLandingPattern`, `migrateLandingDocumentV1ToV2`, `createPrimitiveBlock`,
// `applyDropIntent`/`makeInsertInComposition`, `resolveLandingDrop`, `createFormDocument`.
// Nothing here is hand-written JSON, so the corpus cannot drift away from what the Builder
// actually produces.
//
// `expect.server` is the verdict of `private.builder_landing_document_is_valid` /
// `private.builder_document_is_valid` AFTER the forward corrective migration. Before it, the
// valid v2 fixtures fail â€” that is the RED baseline this corpus exists to capture.

import { createHash } from "node:crypto";
import {
  createLandingDocument,
  createPrimitiveBlock,
  validateLandingDocument,
} from "./landingDocument.js";
import { createLandingPattern } from "./landingPatterns.js";
import { migrateLandingDocumentV1ToV2 } from "./landingComposition.js";
import { applyDropIntent } from "../editor/landingDropV3Apply.js";
import { makeInsertInComposition } from "../editor/landingDropV3Intent.js";
import { resolveLandingDrop } from "../editor/landingDropResolver.js";
import { createFormDocument, validateFormDocument } from "../form/formDocument.js";

// Deterministic id factory: identical output on every run, in every environment.
const deterministicIds = () => {
  let counter = 0;
  return () => {
    counter += 1;
    const tail = String(counter).padStart(12, "0");
    return `00000000-0000-4000-8000-${tail}`;
  };
};

const clone = (value) => JSON.parse(JSON.stringify(value));

// `createLandingPattern` mints its own ids from `crypto.randomUUID`, which cannot be
// injected, so the corpus re-stamps every identity in a fixed document order. The SHAPE of
// each fixture keeps coming from the real factories; only the identities are canonicalised,
// which is what makes the corpus byte-stable and therefore usable as a RED/GREEN baseline.
export const canonicalizeIds = (document, nextId) => {
  const out = clone(document);
  if (out.document_type === "form") {
    // The malformed-Form fixture deliberately carries a non-array `fields`, so guard it.
    for (const field of Array.isArray(out.fields) ? out.fields : []) field.id = nextId();
    return out;
  }
  for (const section of out.sections ?? []) {
    section.id = nextId();
    for (const region of section.regions ?? []) {
      region.id = nextId();
      for (const block of region.blocks ?? []) block.id = nextId();
    }
    for (const node of section.composition ?? []) {
      node.id = nextId();
      // A migrated Pattern carries the identity of the Section it replaced, so it embeds
      // that Section's id and must be re-derived alongside it to stay deterministic.
      if (typeof node.pattern === "string" && node.pattern.startsWith("legacy:")) {
        node.pattern = `legacy:${section.id}`;
      }
      for (const region of node.regions ?? []) {
        region.id = nextId();
        for (const block of region.blocks ?? []) block.id = nextId();
      }
    }
  }
  return out;
};

// A v1 landing document carrying one real catalog Pattern as a legacy Section.
const landingV1With = (patternIds, createId) => {
  const document = createLandingDocument();
  document.sections = patternIds.map((patternId) => createLandingPattern(patternId));
  void createId;
  return document;
};

const migratedV2 = (patternIds, createId) =>
  migrateLandingDocumentV1ToV2(landingV1With(patternIds, createId), { createId });

const compositionOf = (document, index = 0) => document.sections[index].composition;

const independentBlock = (document, type, createId) =>
  applyDropIntent(
    document,
    makeInsertInComposition({
      sectionId: document.sections[0].id,
      anchorIndex: compositionOf(document).length,
      payload: { kind: "palette-block", id: type },
    }),
    { createId },
  );

// Applies an insertion and asserts the applier accepted it, so a fixture can never silently
// degrade into "the client refused to build it".
const withIndependentBlock = (document, type, createId) => {
  const result = independentBlock(document, type, createId);
  if (!result?.ok) {
    throw new Error(`fixture builder: applyDropIntent refused ${type}: ${result?.code} ${result?.because}`);
  }
  return result.document;
};

export function buildServerValidationFixtures() {
  const createId = deterministicIds();
  const fixtures = [];

  const add = (fixture) => fixtures.push(fixture);

  // --- 1. Landing v1 control -------------------------------------------------
  const v1Control = landingV1With(["hero_minimal"], createId);
  add({
    id: "01-landing-v1-control",
    title: "Landing v1 control (one catalog Pattern as a legacy Section)",
    clientValidator: "landing",
    document: v1Control,
    expect: { client: true, server: true },
  });

  // --- 2. Real D3 output: Pattern + independent Text -------------------------
  add({
    id: "02-d3-pattern-plus-text",
    title: "Real D3 INSERT_IN_COMPOSITION of a Text block next to a Pattern",
    clientValidator: "landing",
    document: withIndependentBlock(migratedV2(["hero_minimal"], createId), "text", createId),
    expect: { client: true, server: true },
  });

  // --- 3. Pattern + independent action_group --------------------------------
  add({
    id: "03-pattern-plus-action-group",
    title: "Pattern + independent action_group",
    clientValidator: "landing",
    document: withIndependentBlock(migratedV2(["hero_split"], createId), "action_group", createId),
    expect: { client: true, server: true },
  });

  // --- 4. Pattern + independent Image ---------------------------------------
  add({
    id: "04-pattern-plus-image",
    title: "Pattern + independent image",
    clientValidator: "landing",
    document: withIndependentBlock(migratedV2(["hero_split"], createId), "image", createId),
    expect: { client: true, server: true },
  });

  // --- 5. Pattern only, one Region ------------------------------------------
  add({
    id: "05-pattern-one-region",
    title: "Migrated Pattern only, one Region",
    clientValidator: "landing",
    document: migratedV2(["hero_minimal"], createId),
    expect: { client: true, server: true },
  });

  // --- 6. Pattern with multiple Regions -------------------------------------
  add({
    id: "06-pattern-multi-region",
    title: "Migrated hero_split Pattern with multiple Regions",
    clientValidator: "landing",
    document: migratedV2(["hero_split"], createId),
    expect: { client: true, server: true },
  });

  // --- 7. Multiple PatternNodes ---------------------------------------------
  add({
    id: "07-multiple-pattern-nodes",
    title: "One area holding several Pattern nodes",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      const extra = migrateLandingDocumentV1ToV2(
        (() => {
          const source = createLandingDocument();
          source.sections = [createLandingPattern("cta_centered")];
          return source;
        })(),
        { createId },
      );
      document.sections[0].composition.push(clone(extra.sections[0].composition[0]));
      return document;
    })(),
    expect: { client: true, server: true },
  });

  // --- 8. Pattern + multiple independent Blocks -----------------------------
  add({
    id: "08-pattern-plus-many-blocks",
    title: "Pattern + several independent Blocks in composition order",
    clientValidator: "landing",
    document: (() => {
      let document = migratedV2(["hero_split"], createId);
      document = withIndependentBlock(document, "text", createId);
      document = withIndependentBlock(document, "image", createId);
      document = withIndependentBlock(document, "action_group", createId);
      return document;
    })(),
    expect: { client: true, server: true },
  });

  // --- 9. Independent Block only --------------------------------------------
  add({
    id: "09-independent-block-only",
    title: "Area whose composition is a single independent Block",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].composition = [createPrimitiveBlock("text", createId())];
      return document;
    })(),
    expect: { client: true, server: true },
  });

  // --- 10. Empty composition ------------------------------------------------
  add({
    id: "10-empty-composition",
    title: "Area with an empty composition array",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].composition = [];
      return document;
    })(),
    expect: { client: true, server: true },
  });

  // --- 11. Stack composition ------------------------------------------------
  add({
    id: "11-stack-composition",
    title: "Stack area: Pattern + independent Block",
    clientValidator: "landing",
    document: (() => {
      const document = withIndependentBlock(migratedV2(["hero_minimal"], createId), "text", createId);
      document.sections[0].layout = "stack";
      return document;
    })(),
    expect: { client: true, server: true },
  });

  // --- 12. Columns composition ----------------------------------------------
  add({
    id: "12-columns-composition",
    title: "Columns area holding a multi-Region Pattern",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_split"], createId);
      document.sections[0].layout = "columns";
      return document;
    })(),
    expect: { client: true, server: true },
  });

  // --- 13. Pre-D3 legacy resolveLandingDrop output --------------------------
  add({
    id: "13-legacy-resolve-landing-drop",
    title: "Pre-D3 legacy composition drop output (schema v2)",
    clientValidator: "landing",
    document: (() => {
      const source = landingV1With(["hero_minimal"], createId);
      const decision = resolveLandingDrop(
        source,
        { kind: "palette-block", id: "text" },
        { kind: "composition-before", sectionId: source.sections[0].id, index: 1 },
        { createId },
      );
      if (!decision?.ok) throw new Error(`fixture builder: resolveLandingDrop refused: ${decision?.code}`);
      return decision.document;
    })(),
    expect: { client: true, server: true },
  });

  // --- 14. Valid Form draft -------------------------------------------------
  add({
    id: "14-valid-form",
    title: "Valid Form draft from the client factory",
    clientValidator: "form",
    document: createFormDocument(),
    expect: { client: true, server: true },
  });

  // --- 15. Duplicate source ids --------------------------------------------
  // The collision is injected AFTER canonicalisation (below), because canonicalisation
  // guarantees uniqueness by construction and would otherwise erase this defect.
  add({
    id: "15-duplicate-source-ids",
    title: "Invalid: a Pattern Region id repeated as an independent Block id",
    clientValidator: "landing",
    document: migratedV2(["hero_split"], createId),
    expect: { client: false, server: false },
  });

  // --- 16. Invalid Pattern ownership ---------------------------------------
  add({
    id: "16-invalid-pattern-ownership",
    title: "Invalid: area declares a Pattern-owned style key",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].style = { content_width: "wide" };
      return document;
    })(),
    expect: { client: false, server: false },
  });

  // --- 17. Invalid Block shape ---------------------------------------------
  add({
    id: "17-invalid-block-shape",
    title: "Invalid: independent Block carries an unknown key",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].composition.push({
        id: createId(),
        type: "text",
        schema_version: 1,
        content: { text: "x" },
        bogus: true,
      });
      return document;
    })(),
    expect: { client: false, server: false },
  });

  // --- 18. Schema-version mismatch -----------------------------------------
  add({
    id: "18-schema-version-mismatch",
    title: "Invalid: v2 composition document declared as schema v1",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.schema_version = 1;
      return document;
    })(),
    expect: { client: false, server: false },
  });

  // --- 19. Malformed Form --------------------------------------------------
  add({
    id: "19-malformed-form",
    title: "Invalid: Form whose fields are not an array",
    clientValidator: "form",
    document: (() => {
      const document = createFormDocument();
      document.fields = "no-es-un-array";
      return document;
    })(),
    expect: { client: false, server: false },
  });

  // --- 20. Malformed Landing document --------------------------------------
  add({
    id: "20-malformed-landing",
    title: "Invalid: landing document with no settings envelope",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      delete document.settings;
      return document;
    })(),
    expect: { client: false, server: false },
  });

  // --- 21. Dedicated Footer Section (a real catalog producer) ---------------
  // The catalog and the editor's Header palette both put `content_width`/`align` on the
  // dedicated Section's own style. C.8 applied the Pattern-owned style ban before it worked
  // out that the Section WAS the dedicated surface, so a valid Footer could never be saved.
  add({
    id: "21-dedicated-footer",
    title: "Dedicated Footer Section as the catalog produces it (owns content_width/align)",
    clientValidator: "landing",
    document: migratedV2(["site_footer"], createId),
    expect: { client: true, server: true },
  });

  // --- 22. Block carrying editor-written style keys -------------------------
  // `line_height` / `letter_spacing` are in the client's STYLE_KEYS and are written by the
  // editor's typography controls; C.8's v2 allowlist omitted them, so a valid Block was
  // rejected even though the v1 wrapper handles them.
  add({
    id: "22-block-editor-style-keys",
    title: "Independent Block with line_height/letter_spacing (editor typography controls)",
    clientValidator: "landing",
    document: (() => {
      const document = withIndependentBlock(migratedV2(["hero_minimal"], createId), "text", createId);
      const composition = document.sections[0].composition;
      const block = composition[composition.length - 1];
      block.style = { ...(block.style ?? {}), line_height: "relaxed", letter_spacing: "wide" };
      block.responsive = { mobile: { line_height: "tight", letter_spacing: "normal" } };
      return document;
    })(),
    expect: { client: true, server: true },
  });

  // --- 23. Area carrying an editor-written style key ------------------------
  add({
    id: "23-area-editor-style-keys",
    title: "Composition area whose own style uses line_height/letter_spacing",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].style = {
        ...(document.sections[0].style ?? {}),
        line_height: "relaxed",
        letter_spacing: "normal",
      };
      return document;
    })(),
    expect: { client: true, server: true },
  });

  // --- 24. Pattern node with an illegal style VALUE -------------------------
  // The client validates Pattern style values; the server previously enforced only the key
  // set and never delegated node.style, so this was accepted. A false acceptance.
  add({
    id: "24-pattern-invalid-style-value",
    title: "Invalid: Pattern node style value is not a legal token",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      const pattern = document.sections[0].composition[0];
      pattern.style = { ...(pattern.style ?? {}), align: "middle" };
      return document;
    })(),
    expect: { client: false, server: false },
  });

  // --- 25..28. Dedicated surface with an absent / JSON-null id (R1) --------
  // A dedicated Header/Footer Section is delegated WHOLESALE to the v1 chain, so its Region
  // and Block ids were counted for uniqueness but never validated. An absent id made
  // `#>>` return SQL NULL, which Pass 1 of the projection appended to the collision set;
  // `x = ANY(array_with_NULL)` is NULL, so the salted search of a SIBLING composition area
  // could never exit. Each document therefore carries BOTH a dedicated surface with the
  // broken id and a normal composition area, which is what the round-2 reproduction did.
  add({
    id: "25-dedicated-header-missing-region-id",
    title: "Invalid: dedicated Header with no Region id, beside a composition area",
    clientValidator: "landing",
    document: withDedicatedSurface(createId, "site_header"),
    expect: { client: false, server: false },
  });

  add({
    id: "26-dedicated-footer-missing-region-id",
    title: "Invalid: dedicated Footer with no Region id, beside a composition area",
    clientValidator: "landing",
    document: withDedicatedSurface(createId, "site_footer"),
    expect: { client: false, server: false },
  });

  add({
    id: "27-dedicated-footer-missing-block-id",
    title: "Invalid: dedicated Footer whose Block has no id, beside a composition area",
    clientValidator: "landing",
    document: withDedicatedSurface(createId, "site_footer"),
    expect: { client: false, server: false },
  });

  add({
    id: "28-dedicated-footer-null-region-id",
    title: "Invalid: dedicated Footer with a JSON-null Region id, beside a composition area",
    clientValidator: "landing",
    document: withDedicatedSurface(createId, "site_footer"),
    expect: { client: false, server: false },
  });

  // --- 29..30. Salted collision search ------------------------------------
  // The planted ids are the projection's OWN md5-derived candidates, computed here with the
  // same namespaced digest the migration uses. A search that failed to shift would emit a
  // Region id already present in the document and be rejected as a duplicate, so server
  // validity IS the assertion that the salt moved.
  add({
    id: "29-projection-id-collision-at-salt-0",
    title: "Valid: the salt-0 projection candidate is already a source Block id",
    clientValidator: "landing",
    document: migratedV2(["hero_minimal"], createId),
    expect: { client: true, server: true },
  });

  add({
    id: "30-projection-id-collision-needs-salt-increment",
    title: "Valid: the salt-0 AND salt-1 candidates are already source Block ids",
    clientValidator: "landing",
    document: migratedV2(["hero_minimal"], createId),
    expect: { client: true, server: true },
  });

  // --- 31..35. `style.background` on a Pattern node (R5/R6) ----------------
  add({
    id: "31-pattern-background-invalid-string",
    title: "Invalid: Pattern node style.background is not a legal token string",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      const pattern = document.sections[0].composition[0];
      pattern.style = { ...(pattern.style ?? {}), background: "Not A Token!" };
      return document;
    })(),
    expect: { client: false, server: false },
  });

  add({
    id: "32-pattern-background-valid-token",
    title: "Valid: Pattern node style.background is a legal token string",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      const pattern = document.sections[0].composition[0];
      pattern.style = { ...(pattern.style ?? {}), background: "surface" };
      return document;
    })(),
    expect: { client: true, server: true },
  });

  add({
    id: "33-pattern-solid-background-valid-color",
    title: "Valid: Pattern node solid background with a legal colour token",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      const pattern = document.sections[0].composition[0];
      pattern.style = { ...(pattern.style ?? {}), background: { type: "solid", color: "surface" } };
      return document;
    })(),
    expect: { client: true, server: true },
  });

  add({
    id: "34-pattern-solid-background-invalid-color",
    title: "Invalid: Pattern node solid background with an illegal colour token",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      const pattern = document.sections[0].composition[0];
      pattern.style = { ...(pattern.style ?? {}), background: { type: "solid", color: "Not A Token!" } };
      return document;
    })(),
    expect: { client: false, server: false },
  });

  // --- 35..37. Recorded, deliberate server-stricter divergences ------------
  // `expect.server: false` with `expect.client: true` is a KNOWN divergence, not a defect to
  // be discovered later: the server is deliberately stricter than the client in these three
  // places (documented in the ROUND-2 block of the forward migration and in the corpus
  // test). No real producer emits any of them.
  add({
    id: "35-known-divergence-pattern-solid-missing-color",
    title: "KNOWN DIVERGENCE: server requires a colour for a solid background, the client does not",
    clientValidator: "landing",
    knownDivergence: "server requires `background.color` for type=solid; the client's validToken(undefined) is true",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      const pattern = document.sections[0].composition[0];
      pattern.style = { ...(pattern.style ?? {}), background: { type: "solid" } };
      return document;
    })(),
    expect: { client: true, server: false },
  });

  add({
    id: "36-known-divergence-area-responsive-text-size",
    title: "KNOWN DIVERGENCE: server restricts area responsive keys to the v1 set",
    clientValidator: "landing",
    knownDivergence: "client RESPONSIVE_STYLE_KEYS is wider than the v1 area override key set",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].responsive = { tablet: { text_size: "lg" } };
      return document;
    })(),
    expect: { client: true, server: false },
  });

  add({
    id: "37-known-divergence-pattern-responsive-bad-value",
    title: "KNOWN DIVERGENCE: server value-checks Pattern responsive overrides, the client only key-checks",
    clientValidator: "landing",
    knownDivergence: "client validatePatternNode only checks PATTERN_RESPONSIVE_KEYS, not the values",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      const pattern = document.sections[0].composition[0];
      pattern.responsive = { tablet: { align: "middle" } };
      return document;
    })(),
    expect: { client: true, server: false },
  });

  // --- 38..40. Envelope keys that could be ABSENT and still pass (R3) ------
  add({
    id: "38-v2-design-system-missing",
    title: "Invalid: v2 document whose settings.design_system is absent",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      delete document.settings.design_system;
      return document;
    })(),
    expect: { client: false, server: false },
  });

  add({
    id: "39-v2-seo-title-missing",
    title: "Invalid: v2 document whose settings.seo.title is absent",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      delete document.settings.seo.title;
      return document;
    })(),
    expect: { client: false, server: false },
  });

  add({
    id: "40-v2-locale-missing",
    title: "Invalid: v2 document with no locale",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      delete document.locale;
      return document;
    })(),
    expect: { client: false, server: false },
  });

  // --- 41..60. Background type contract + locale envelope (ROUND-3 M2 / LOW-1) ----------
  // The client's authoritative contract is landingDocument.js:290-433: a closed key set, a
  // `type` in {none,transparent,solid,image,gradient}, a PER-TYPE key restriction
  // (`keysByType`, :329-355), and the per-type value rules including overlay_color (token) and
  // overlay_opacity (a discrete 0..80 step-10 set). Every case is exercised on a Pattern node,
  // because a Pattern node's style is the one this migration validates natively â€” the AREA and
  // BLOCK forms are additionally delegated to the frozen v1 rules.
  const backgroundCase = (id, background, expected) => add({
    id,
    title: `${expected ? "Valid" : "Invalid"}: Pattern node background ${JSON.stringify(background)}`,
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      const pattern = document.sections[0].composition[0];
      pattern.style = { ...(pattern.style ?? {}), background };
      return document;
    })(),
    expect: { client: expected, server: expected },
  });

  backgroundCase("41-background-none-valid", { type: "none" }, true);
  backgroundCase("42-background-none-extra-key", { type: "none", color: "surface" }, false);
  backgroundCase("43-background-transparent-valid", { type: "transparent" }, true);
  backgroundCase("44-background-transparent-extra-key", { type: "transparent", url: "https://cdn.example/x.png" }, false);
  backgroundCase("45-background-solid-extra-url", { type: "solid", color: "surface", url: "https://cdn.example/x.png" }, false);
  backgroundCase("46-background-solid-extra-overlay", { type: "solid", color: "surface", overlay_opacity: 40 }, false);
  backgroundCase("47-background-image-valid", {
    type: "image", url: "https://cdn.example/x.png", fit: "cover", position: "center",
    overlay_color: "text", overlay_opacity: 40,
  }, true);
  backgroundCase("48-background-image-missing-url", { type: "image" }, false);
  backgroundCase("49-background-image-http-url", { type: "image", url: "http://insecure.example/x.png" }, false);
  backgroundCase("50-background-image-bad-overlay-color", {
    type: "image", url: "https://cdn.example/x.png", overlay_color: "Not A Token!",
  }, false);
  backgroundCase("51-background-image-bad-overlay-opacity", {
    type: "image", url: "https://cdn.example/x.png", overlay_opacity: 45,
  }, false);
  backgroundCase("52-background-image-string-overlay-opacity", {
    type: "image", url: "https://cdn.example/x.png", overlay_opacity: "40",
  }, false);
  backgroundCase("53-background-image-extra-gradient-key", {
    type: "image", url: "https://cdn.example/x.png", gradient: "aurora",
  }, false);
  backgroundCase("54-background-gradient-valid", { type: "gradient", gradient: "aurora" }, true);
  backgroundCase("55-background-gradient-bogus", { type: "gradient", gradient: "bogus" }, false);
  backgroundCase("56-background-gradient-extra-url", { type: "gradient", gradient: "aurora", url: "https://cdn.example/x.png" }, false);
  backgroundCase("57-background-unknown-type", { type: "neon" }, false);
  backgroundCase("58-background-image-bad-fit", { type: "image", url: "https://cdn.example/x.png", fit: "fill" }, false);
  backgroundCase("59-background-image-bad-position", { type: "image", url: "https://cdn.example/x.png", position: "diagonal" }, false);

  // LOW-1: the client requires a non-blank locale; the v2 envelope now does too.
  add({
    id: "60-v2-locale-whitespace",
    title: "Invalid: v2 document whose locale is whitespace only",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.locale = "   ";
      return document;
    })(),
    expect: { client: false, server: false },
  });

  // --- 61..62. ROUND-4 F1: a colour token must be a JSON STRING (regression) --------------
  // The server applied its token regex to `jsonb ->> key`, which STRINGIFIES any JSON value, so
  // a boolean colour became the text that the token pattern matches. The client's `validToken`
  // is a typeof check and rejects it, so the server ACCEPTED documents the client rejects.
  // These fixtures pin the repaired behaviour: the value must be a JSON string before the token
  // rules are consulted. Both are client-invalid AND server-invalid, so they cannot disturb the
  // "recorded divergences" test.
  //
  // The SAME textual pattern also appears on a Pattern's responsive `spacing` override and is
  // deliberately NOT changed: the client's pattern-responsive validator checks KEYS only
  // (recorded divergence 37), so it ACCEPTS a boolean `spacing` - guarding it there would create
  // a NEW server-stricter divergence rather than restore agreement. Reported, not repaired.
  const patternTokenCase = (id, title, apply) => add({
    id,
    title,
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      apply(document.sections[0].composition[0]);
      return document;
    })(),
    expect: { client: false, server: false },
  });

  patternTokenCase(
    "61-background-solid-color-boolean",
    "Invalid: Pattern node solid background colour is a JSON boolean, not a string token",
    (pattern) => {
      pattern.style = { ...(pattern.style ?? {}), background: { type: "solid", color: true } };
    },
  );

  patternTokenCase(
    "62-background-image-overlay-color-boolean",
    "Invalid: Pattern node image overlay_color is a JSON boolean, not a string token",
    (pattern) => {
      pattern.style = {
        ...(pattern.style ?? {}),
        background: { type: "image", url: "https://cdn.example/x.png", overlay_color: false },
      };
    },
  );

  // Third site of the same root cause: the AREA's responsive override block validated `spacing`
  // by KEY only, so a JSON boolean was accepted there while the client rejects it. The gap is
  // pre-existing in the frozen C.8 controller; it is repaired in the forward migration.
  add({
    id: "63-area-responsive-spacing-boolean",
    title: "Invalid: area responsive spacing override is a JSON boolean, not a string token",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].responsive = { tablet: { spacing: false } };
      return document;
    })(),
    expect: { client: false, server: false },
  });

  // Positive control for the same site: a legal token must still be accepted, so the repair
  // cannot have turned the whole key into a rejection.
  add({
    id: "64-area-responsive-spacing-valid-token",
    title: "Valid: area responsive spacing override with a legal design token",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].responsive = { tablet: { spacing: "md" } };
      return document;
    })(),
    expect: { client: true, server: true },
  });

  // --- 65..76. ROUND-6: NULL-blind / type-coerced v2-native false acceptances ---------------
  // Each case below was a confirmed client-INVALID / server-VALID divergence before this repair:
  // `->>` yields SQL NULL for JSON null, and `NULL not in (...)` / `jsonb_typeof(x) <> 'number'`
  // are NULL (not TRUE), so the invalid branch was skipped. The expected results are the REAL
  // client verdicts, and every case is client-invalid AND server-invalid, so none of them can
  // disturb the "recorded divergences" assertion. Positives (75, 76) prove the guards did not
  // over-reject a valid shape.
  const areaResponsiveCase = (id, title, override, expected) => add({
    id,
    title,
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].responsive = override;
      return document;
    })(),
    expect: { client: expected, server: expected },
  });

  // Medium 1: area-responsive layout/align, JSON null and wrong types, both breakpoints.
  areaResponsiveCase("65-area-responsive-layout-null", "Invalid: area responsive tablet.layout is JSON null", { tablet: { layout: null } }, false);
  areaResponsiveCase("66-area-responsive-layout-null-mobile", "Invalid: area responsive mobile.layout is JSON null", { mobile: { layout: null } }, false);
  areaResponsiveCase("67-area-responsive-align-null", "Invalid: area responsive tablet.align is JSON null", { tablet: { align: null } }, false);
  areaResponsiveCase("68-area-responsive-align-null-mobile", "Invalid: area responsive mobile.align is JSON null", { mobile: { align: null } }, false);
  areaResponsiveCase("69-area-responsive-layout-boolean", "Invalid: area responsive tablet.layout is a JSON boolean", { tablet: { layout: true } }, false);
  areaResponsiveCase("70-area-responsive-align-object", "Invalid: area responsive tablet.align is a JSON object", { tablet: { align: {} } }, false);

  // Medium 2: section.layout, pattern.layout, region.span, and text-coerced schema_version.
  // The two absence cases are applied AFTER canonicalisation (below), because canonicalisation
  // walks the document and would otherwise leave the key absent in a different order.
  add({
    id: "71-section-layout-null",
    title: "Invalid: section.layout is JSON null (the client requires a layout)",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].layout = null;
      return document;
    })(),
    expect: { client: false, server: false },
  });

  add({
    id: "72-pattern-layout-null",
    title: "Invalid: Pattern node layout is JSON null (the client requires a layout)",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].composition[0].layout = null;
      return document;
    })(),
    expect: { client: false, server: false },
  });

  add({
    id: "73-region-span-null",
    title: "Invalid: Pattern Region span is JSON null (the client requires 1..12)",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].composition[0].regions[0].span = null;
      return document;
    })(),
    expect: { client: false, server: false },
  });

  add({
    id: "74-schema-version-string",
    title: 'Invalid: top-level schema_version is the JSON string "2", not the number 2',
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.schema_version = "2";
      return document;
    })(),
    expect: { client: false, server: false },
  });

  // Positive controls: the same fields with legal values must stay accepted.
  add({
    id: "75-section-and-pattern-layout-valid",
    title: "Valid: section.layout and Pattern layout are both legal enum strings",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].layout = "stack";
      document.sections[0].composition[0].layout = "stack";
      return document;
    })(),
    expect: { client: true, server: true },
  });

  add({
    id: "76-region-span-valid-boundary",
    title: "Valid: Pattern Region span at the legal boundaries 1 and 12",
    clientValidator: "landing",
    document: (() => {
      const document = migratedV2(["hero_minimal"], createId);
      document.sections[0].composition[0].regions[0].span = 12;
      return document;
    })(),
    expect: { client: true, server: true },
  });


  // --- 77..79. ROUND-6: the "required key is ABSENT" half of the same defect ---------------
  // `jsonb_typeof(x) <> 'number'` / `x->>'k' not in (...)` are NULL when the key is absent, so
  // the invalid branch was skipped. Deleted AFTER canonicalisation, like the dedicated-id
  // defects below, because canonicalisation walks the document.
  const absentCase = (id, title) => add({
    id,
    title,
    clientValidator: "landing",
    document: migratedV2(["hero_minimal"], createId),
    expect: { client: false, server: false },
  });

  absentCase("77-section-layout-absent", "Invalid: section.layout is absent entirely");
  absentCase("78-pattern-layout-absent", "Invalid: Pattern node layout is absent entirely");
  absentCase("79-region-span-absent", "Invalid: Pattern Region span is absent entirely");

  // Canonicalise identities so the corpus is byte-stable, then re-inject every defect that
  // canonicalisation deliberately removes: duplicate ids, the absent/JSON-null dedicated ids
  // and the planted projection-id collisions. All of them are applied AFTER canonicalisation
  // because canonicalisation guarantees uniqueness and presence by construction.
  for (const fixture of fixtures) {
    fixture.document = canonicalizeIds(fixture.document, createId);
  }
  {
    // ROUND-6: strip the required key for the three absence cases, after canonicalisation for
    // the same reason as the dedicated-id deletions below.
    const doc = (id) => fixtures.find((f) => f.id === id).document;
    delete doc("77-section-layout-absent").sections[0].layout;
    delete doc("78-pattern-layout-absent").sections[0].composition[0].layout;
    delete doc("79-region-span-absent").sections[0].composition[0].regions[0].span;
  }

  {
    const duplicate = fixtures.find((fixture) => fixture.id === "15-duplicate-source-ids");
    const composition = duplicate.document.sections[0].composition;
    const repeated = composition[0].regions[0].id;
    composition.push({
      id: repeated,
      type: "text",
      schema_version: 1,
      content: { text: "duplicado" },
    });
  }
  {
    const dedicated = (id) => fixtures.find((fixture) => fixture.id === id).document.sections[1].regions[0];
    delete dedicated("25-dedicated-header-missing-region-id").id;
    delete dedicated("26-dedicated-footer-missing-region-id").id;
    delete dedicated("27-dedicated-footer-missing-block-id").blocks[0].id;
    dedicated("28-dedicated-footer-null-region-id").id = null;
  }
  {
    // Plant the projection's own md5 candidates as real source Block ids, so the salted
    // search has to shift. Applied after canonicalisation so they survive.
    const plant = (fixtureId, salts) => {
      const document = fixtures.find((fixture) => fixture.id === fixtureId).document;
      const areaId = document.sections[0].id;
      const composition = document.sections[0].composition;
      for (const salt of salts) {
        composition.push({
          id: projectionRegionId(areaId, salt),
          type: "text",
          schema_version: 1,
          content: { text: `candidate-${salt}` },
        });
      }
    };
    plant("29-projection-id-collision-at-salt-0", [0]);
    plant("30-projection-id-collision-needs-salt-increment", [0, 1]);
  }

  return fixtures;
}

// Which client validator applies to a fixture, and what it says.
export function clientVerdict(fixture) {
  const result =
    fixture.clientValidator === "form"
      ? validateFormDocument(fixture.document)
      : validateLandingDocument(fixture.document);
  return {
    valid: Boolean(result?.valid),
    errors: (result?.errors ?? []).map((error) =>
      typeof error === "string" ? error : `${error.path}:${error.code}`,
    ),
  };
}

export const FIXTURE_COUNT = 79;

// A migrated v2 composition area PLUS one dedicated surface Section, so the dedicated
// Section's ids reach Pass 1 of the projection while a sibling composition area still drives
// the salted search. `site_footer` uses the real catalog producer; `site_header` is assembled
// exactly as the editor's Header palette does it: one protected surface alone in its own
// Section (the catalog ships no Header pattern).
export function withDedicatedSurface(createId, surfaceType) {
  const document = migratedV2(["hero_minimal"], createId);
  const section = surfaceType === "site_footer"
    ? createLandingPattern("site_footer")
    : {
        id: createId(),
        layout: "stack",
        regions: [{ id: createId(), span: 12, blocks: [createPrimitiveBlock("site_header", createId())] }],
      };
  document.sections.push(section);
  return document;
}

// The projection's synthetic Region identity, re-derived here with the SAME namespaced digest
// the migration uses (`private.builder_landing_projection_region_id`). Only used to plant
// adversarial source ids; the authoritative collision assertions live in the SQL suite, which
// calls the real function, so a drift between this copy and SQL can only weaken a fixture â€”
// never make a broken server look correct.
export function projectionRegionId(areaId, salt) {
  const digest = createHash("md5")
    .update(`orvesen:landing-v2-projection:region:${areaId ?? ""}:${salt ?? 0}`, "utf8")
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

