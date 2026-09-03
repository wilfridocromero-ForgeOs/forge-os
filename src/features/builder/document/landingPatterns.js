import { createPrimitiveBlock } from "./landingDocument.js";

const id = () => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0")
  );

  return `${hex.slice(0, 4).join("")}-${hex
    .slice(4, 6)
    .join("")}-${hex.slice(6, 8).join("")}-${hex
    .slice(8, 10)
    .join("")}-${hex.slice(10).join("")}`;
};

const region = (blocks, span = 12) => ({
  id: id(),
  span,
  blocks,
});

const section = (layout, regions, style = undefined) => ({
  id: id(),
  layout,
  ...(style ? { style } : {}),
  regions,
});

const block = (type, content) =>
  createPrimitiveBlock(type, id(), content);

const previewFor = (group, idValue) => {
  if (group === "Hero") {
    return idValue === "hero_split" ||
      idValue === "hero_image" ||
      idValue === "hero_conversion"
      ? "split"
      : "hero";
  }

  if (group === "Social Proof") {
    return idValue === "logo_row" ? "logos" : "stats";
  }

  if (["Features", "Services"].includes(group)) {
    return "cards";
  }

  if (group === "Testimonials") return "quotes";
  if (group === "Media") return "media";
  if (group === "Pricing") return "pricing";
  if (group === "FAQ") return "faq";
  if (group === "CTA") return "cta";
  if (group === "Lead Capture") return "form";

  return "footer";
};

export const LANDING_PATTERN_CATALOG = Object.freeze(
  [
    ["hero_minimal", "Hero", "Minimal"],
    ["hero_split", "Hero", "Split"],
    ["hero_image", "Hero", "Image Focus"],
    ["hero_conversion", "Hero", "Conversion"],

    ["logo_row", "Social Proof", "Logo Row"],
    ["stats_row", "Social Proof", "Stats Row"],

    ["features_3", "Features", "3 Feature Grid"],
    ["features_6", "Features", "6 Feature Grid"],
    ["services", "Services", "Service Cards"],

    ["testimonial_single", "Testimonials", "Single Testimonial"],
    ["testimonial_grid", "Testimonials", "Testimonial Grid"],

    ["video_feature", "Media", "Video Feature"],

    ["pricing_3", "Pricing", "3 Plan Pricing"],

    ["faq_list", "FAQ", "FAQ List"],

    ["cta_centered", "CTA", "Centered CTA"],
    ["cta_split", "CTA", "Split CTA"],

    ["lead_form", "Lead Capture", "Lead Form"],
    ["lead_split", "Lead Capture", "Split Lead Capture"],

    ["footer_simple", "Footer", "Simple Footer"],
    ["footer_business", "Footer", "Business Footer"],
  ].map(([idValue, group, label]) => ({
    id: idValue,
    group,
    label,
    preview: previewFor(group, idValue),
  }))
);

const feature = (title) =>
  block("feature_item", {
    icon: "sparkles",
    title,
    description:
      "Una capacidad diseñada para producir resultados sostenibles.",
    href: "",
  });

const stat = (value, label) =>
  block("stat", {
    value,
    label,
    supporting_text: "Evidencia clara para decidir mejor.",
  });

export function createHeroPattern() {
  return createLandingPattern("hero_split");
}

export function createCtaPattern() {
  return createLandingPattern("cta_centered");
}

export function createLeadCapturePattern(formAssetId = null) {
  return createLandingPattern("lead_split", {
    formAssetId,
  });
}

export function createLandingPattern(
  patternId,
  { formAssetId = null } = {}
) {
  switch (patternId) {
    case "hero_minimal":
      return section(
        "stack",
        [
          region([
            block("heading", {
              text: "Una propuesta clara para avanzar",
              level: 1,
            }),
            block("text", {
              text: "Explica el valor principal con precisión y confianza.",
            }),
            block("action_group"),
          ]),
        ],
        {
          content_width: "narrow",
          align: "center",
        }
      );

    case "hero":
    case "hero_split":
      return section(
        "columns",
        [
          region(
            [
              block("heading", {
                text: "Una propuesta clara para avanzar",
                level: 1,
              }),
              block("text", {
                text: "Explica el valor principal con precisión y confianza.",
              }),
              block("action_group"),
            ],
            7
          ),
          region([block("image")], 5),
        ],
        {
          content_width: "wide",
          align: "center",
        }
      );

    case "hero_image":
      return section(
        "columns",
        [
          region([block("image")], 7),

          region(
            [
              block("heading", {
                text: "Haz visible la diferencia",
                level: 1,
              }),
              block("text", {
                text: "Una historia visual con contexto empresarial.",
              }),
            ],
            5
          ),
        ],
        {
          content_width: "wide",
          align: "center",
        }
      );

    case "hero_conversion":
      return section("columns", [
        region(
          [
            block("heading", {
              text: "Convierte interés en una decisión",
              level: 1,
            }),
            block("text", {
              text: "Una entrada enfocada en valor y acción.",
            }),
            block("action_group"),
          ],
          7
        ),

        region(
          [
            block("form_reference", {
              asset_id: formAssetId,
              label: "Formulario principal",
            }),
          ],
          5
        ),
      ]);

    case "logo_row":
      return section(
        "columns",
        [1, 2, 3, 4].map((item) =>
          region(
            [
              block("logo", {
                url: `https://example.com/logo-${item}.png`,
                alt: `Marca ${item}`,
                width: "md",
                href: "",
              }),
            ],
            3
          )
        ),
        {
          content_width: "wide",
          align: "center",
        }
      );

    case "stats_row":
      return section(
        "columns",
        [
          region([stat("37%", "Más conversiones")], 4),
          region([stat("2.4×", "Mayor velocidad")], 4),
          region([stat("91%", "Claridad operativa")], 4),
        ],
        {
          content_width: "wide",
          align: "center",
        }
      );

    case "features_3":
      return section(
        "columns",
        ["Inteligencia", "Control", "Crecimiento"].map((title) =>
          region([feature(title)], 4)
        ),
        {
          content_width: "wide",
        }
      );

    case "features_6":
      return section(
        "columns",
        [
          "Estrategia",
          "Operaciones",
          "Clientes",
          "Proyectos",
          "Evidencia",
          "Decisiones",
        ].map((title) => region([feature(title)], 2)),
        {
          content_width: "wide",
        }
      );

    case "services":
      return section(
        "columns",
        ["Diagnóstico", "Implementación", "Evolución"].map((title) =>
          region([feature(title)], 4)
        ),
        {
          content_width: "wide",
        }
      );

    case "testimonial_single":
      return section(
        "stack",
        [region([block("testimonial")])],
        {
          content_width: "narrow",
          align: "center",
        }
      );

    case "testimonial_grid":
      return section(
        "columns",
        [1, 2, 3].map((item) =>
          region(
            [
              block("testimonial", {
                quote: `Testimonio empresarial ${item}.`,
                person_name: `Persona ${item}`,
                role_company: "Dirección · Empresa",
                avatar_url: "",
              }),
            ],
            4
          )
        ),
        {
          content_width: "wide",
        }
      );

    case "video_feature":
      return section(
        "columns",
        [
          region(
            [
              block("heading", {
                text: "Conoce cómo funciona",
                level: 2,
              }),
              block("text", {
                text: "Presenta el sistema con contexto y claridad.",
              }),
            ],
            5
          ),

          region([block("video")], 7),
        ],
        {
          content_width: "wide",
          align: "center",
        }
      );

    case "pricing_3":
      return section(
        "columns",
        ["Esencial", "Profesional", "Empresa"].map((name, index) =>
          region(
            [
              block("pricing_card", {
                plan_name: name,

                price:
                  index === 0
                    ? "$49"
                    : index === 1
                    ? "$99"
                    : "A medida",

                cadence: index === 2 ? "" : "/mes",

                description:
                  "Una solución estructurada para avanzar.",

                features: [
                  "Capacidad principal",
                  "Soporte",
                  "Evidencia",
                ],

                cta_label: "Elegir plan",
                cta_url: "#",

                emphasis: index === 1,
              }),
            ],
            4
          )
        ),
        {
          content_width: "wide",
        }
      );

    case "faq_list":
      return section(
        "stack",
        [
          region(
            [1, 2, 3, 4].map((item) =>
              block("faq_item", {
                question: `Pregunta frecuente ${item}`,
                answer:
                  "Una respuesta breve, precisa y útil.",
                default_open: item === 1,
              })
            )
          ),
        ],
        {
          content_width: "narrow",
        }
      );

    case "cta_centered":
      return section(
        "stack",
        [
          region([
            block("heading", {
              text: "Da el siguiente paso",
              level: 2,
            }),

            block("text", {
              text: "Convierte la propuesta en una acción clara y directa.",
            }),

            block("action_group"),
          ]),
        ],
        {
          content_width: "standard",
          align: "center",
        }
      );

    case "cta_split":
      return section(
        "columns",
        [
          region(
            [
              block("heading", {
                text: "Es momento de avanzar",
                level: 2,
              }),
            ],
            7
          ),

          region([block("action_group")], 5),
        ],
        {
          align: "center",
        }
      );

    case "lead_form":
      return section(
        "stack",
        [
          region([
            block("heading", {
              text: "Hablemos",
              level: 2,
            }),

            block("form_reference", {
              asset_id: formAssetId,
              label: "Formulario de contacto",
            }),
          ]),
        ],
        {
          content_width: "narrow",
        }
      );

    case "lead_split":
      return section("columns", [
        region(
          [
            block("heading", {
              text: "Hablemos de tu próximo paso",
              level: 2,
            }),

            block("text", {
              text: "Déjanos tus datos y continuamos la conversación.",
            }),
          ],
          7
        ),

        region(
          [
            block("form_reference", {
              asset_id: formAssetId,
              label: "Formulario de contacto",
            }),
          ],
          5
        ),
      ]);

    case "footer_simple":
      return section(
        "columns",
        [
          region(
            [
              block("logo", {
                url: "https://example.com/logo.png",
                alt: "Marca",
                width: "sm",
                href: "",
              }),

              block("text", {
                text: "© Empresa. Todos los derechos reservados.",
              }),
            ],
            8
          ),

          region([block("social_links")], 4),
        ],
        {
          content_width: "wide",
        }
      );

    case "footer_business":
      return section(
        "columns",
        [
          region(
            [
              block("logo", {
                url: "https://example.com/logo.png",
                alt: "Marca",
                width: "md",
                href: "",
              }),

              block("text", {
                text: "Inteligencia empresarial para avanzar.",
              }),
            ],
            5
          ),

          region([feature("Empresa")], 3),

          region([block("social_links")], 4),
        ],
        {
          content_width: "wide",
        }
      );

    default:
      return null;
  }
}