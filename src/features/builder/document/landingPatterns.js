import { createPrimitiveBlock } from "./landingDocument.js";

const id = () => crypto.randomUUID();
const region = (blocks, span = 12) => ({ id: id(), span, blocks });
const section = (layout, regions, style = undefined) => ({ id: id(), layout, ...(style ? { style } : {}), regions });

export function createHeroPattern() {
  return section("columns", [
    region([
      createPrimitiveBlock("heading", id(), { text: "Una propuesta clara para avanzar", level: 1 }),
      createPrimitiveBlock("text", id(), { text: "Explica el valor principal con precisión y confianza." }),
      createPrimitiveBlock("action_group", id()),
    ], 7),
    region([createPrimitiveBlock("image", id())], 5),
  ], { content_width: "wide", align: "center" });
}

export function createCtaPattern() {
  return section("stack", [region([
    createPrimitiveBlock("heading", id(), { text: "Da el siguiente paso", level: 2 }),
    createPrimitiveBlock("text", id(), { text: "Convierte la propuesta en una acción clara y directa." }),
    createPrimitiveBlock("action_group", id()),
  ])], { content_width: "standard", align: "center" });
}

export function createLeadCapturePattern(formAssetId = null) {
  return section("columns", [
    region([
      createPrimitiveBlock("heading", id(), { text: "Hablemos de tu próximo paso", level: 2 }),
      createPrimitiveBlock("text", id(), { text: "Déjanos tus datos y continuamos la conversación." }),
    ], 7),
    region([createPrimitiveBlock("form_reference", id(), { asset_id: formAssetId, label: "Formulario de contacto" })], 5),
  ]);
}
