# ORVESEN Email Marketing — Arquitectura

Estado: Increments 1 (Foundation & Safety Core) y 2 (Audiences, solo base de
datos) aplicados y validados en Staging (acceptance runner Inc1–2: PASS 170/170).
Increment 3a (senders, templates, validación `email-content.v1`) implementado
localmente, pendiente de revisión y de Staging.
Rama: `claude/v1`. Dueño del dominio: Claude Code (desarrollo paralelo con Codex y DeepSeek).

> Este dominio registra evidencia de consentimiento y aplica reglas de envío
> *fail-closed*. **No constituye por sí mismo cumplimiento legal** de ninguna
> jurisdicción (GDPR, CAN-SPAM, leyes locales). La política legal aplicable debe
> definirse por separado.

## 1. Principios

1. **ORVESEN es dueño de la lógica.** El proveedor de email es solo infraestructura
   de entrega detrás de un `ProviderAdapter` (Increment 4). V1 asume una cuenta
   gestionada por ORVESEN, pero el modelo no impide conexiones por tenant (BYOP).
2. **Aislamiento multi-tenant estructural.** Toda fila tiene `organization_id`;
   las referencias internas usan claves compuestas `(organization_id, id)`.
3. **Organización y actor se derivan en el servidor** (`auth.uid()` y
   `public.current_user_organization_id()`); ningún RPC los acepta como parámetro.
4. **Escritura solo vía RPC.** Los roles de API (`anon`, `authenticated`,
   `service_role`) no tienen DML directo; triggers protegen invariantes para
   cualquier rol.
5. **Fail-closed.** Ante evidencia ausente o inconsistente, un contacto no es enviable.
6. **Propuesta ≠ ejecución.** Orb podrá proponer; aprobar un envío será siempre
   una acción humana (Increment 5+).
7. **Sin bypass de plataforma.** Los objetos `email_*` no usan `is_platform_owner()`.

## 2. Arquitectura objetivo

```
UI Email ──RPC/RLS──┐
Orb (capabilities) ─┤→ Dominio Email (Postgres: email_*, RPCs, state machines, auditoría)
Builder/CRM/Ventas ─┘        │ scheduler → send_jobs            (Increment 5)
                             ▼
             email-dispatch (worker) → ProviderAdapter → proveedor
                                                  │
             email-webhooks / email-unsubscribe ◄─┘              (Increment 6)
                             ▼
       inbox → email_events → supresión / métricas → Goal Engine / Score / Orb
```

## 3. Increment 1 — implementado

Migración: `supabase/migrations/20260926160000_email_marketing_v1_foundation.sql`.

### 3.1 Tablas

| Tabla | Propósito | Mutabilidad |
|---|---|---|
| `email_contacts` | Personas destinatarias por organización. `email_normalized` único por organización. | Identidad inmutable (`email`, `organization_id`, `source`, `created_*`). Estado `active → archived` (terminal en V1). Sin borrado. `version` se incrementa en cada cambio. |
| `email_contact_consents` | Ledger de evidencia de consentimiento (`granted` / `revoked`). | Append-only (UPDATE/DELETE/TRUNCATE rechazados para todo rol). |
| `email_suppressions` | Supresión por **dirección** normalizada (no por contacto). | Se crea activa; solo puede levantarse una vez (`lifted_*`); sin borrado. |
| `email_audit_log` | Auditoría de todas las mutaciones del dominio. | Inmutable. No guarda direcciones en claro (usa hash SHA-256). |

Todas las FKs a `organizations` usan `ON DELETE RESTRICT`: una organización con
datos de email no puede borrarse sin un procedimiento explícito de baja
(protege el historial).

### 3.2 Funciones internas (`private`)

| Función | Uso |
|---|---|
| `email_normalize_address(text)` | `lower` + `trim`; valida formato; ASCII (IDN en punycode). No elimina puntos ni `+tag`. Devuelve `null` si es inválida. |
| `email_can(action)` | **Único punto de decisión de autorización.** Increment 1: `founder`/`admin` de la organización activa. Acciones desconocidas → `false`. |
| `email_require(action)` | Devuelve la organización activa o lanza `EMAIL_ACCESS_DENIED`. |
| `email_is_sendable(org, contact, purpose)` | Evaluación fail-closed para llamadores de servidor de confianza. No ejecutable por ningún rol de API. |
| `email_write_audit(...)` | Escritor de auditoría; actor = `auth.uid()` o `system`. |

`email_can` se consulta directamente sobre `organization_memberships` en lugar de
`can_manage_organization()` para que el dominio no herede cambios futuros de un
helper compartido (p. ej. un bypass de plataforma).

### 3.3 RPCs (`public`, `SECURITY DEFINER`, `search_path = ''`)

| RPC | Acción | Idempotencia |
|---|---|---|
| `email_create_contact(email, first_name, last_name, locale, timezone, source)` | `manage_contacts` | Por dirección normalizada: repetir devuelve el contacto existente (`was_created=false`) sin modificarlo. Contacto archivado → `EMAIL_CONTACT_ARCHIVED`. |
| `email_update_contact(contact_id, changes jsonb, expected_version)` | `manage_contacts` | Parche con claves `first_name,last_name,locale,timezone`; control optimista por `version`; no-op no incrementa versión. |
| `email_archive_contact(contact_id, reason)` | `manage_contacts` | Archivar de nuevo devuelve la fila sin cambios. |
| `email_record_consent(contact_id, method, source, consent_text, consent_text_version, occurred_at, evidence, purpose, idempotency_key)` | `manage_consent` | Con clave: replay idéntico devuelve la entrada original; payload distinto → `EMAIL_IDEMPOTENCY_CONFLICT`. |
| `email_revoke_consent(contact_id, method, reason, occurred_at, purpose, idempotency_key)` | `manage_consent` | Igual que arriba. Un replay **no** vuelve a suprimir una dirección levantada legítimamente. |
| `email_add_suppression(email, reason, note)` | `manage_suppressions` | Una supresión activa por dirección; repetir devuelve la existente. |
| `email_lift_suppression(suppression_id, reason)` | `lift_suppression` | Levantar dos veces → `EMAIL_SUPPRESSION_ALREADY_LIFTED`. |

Códigos de error: `42501` acceso / no encontrado (sin revelar existencia entre
tenants), `22023` argumentos, `55000` estado inválido, `40001` conflicto de versión.

### 3.4 Modelo de consentimiento

- Propósito único en V1: `marketing`.
- Un `granted` solo es representable con evidencia completa (CHECK):
  `method`, `source`, `consent_text`, `consent_text_version`, `occurred_at`,
  `recorded_by` (quien atestigua) y `evidence` jsonb opcional (≤ 8 KB).
- Métodos de alta permitidos a usuarios: `manual_entry`, `written`, `verbal`,
  `import_attestation`, `external_form`. No se permite `double_opt_in_confirmation`:
  se reservará para el flujo de sistema de doble opt-in (futuro). No se codifica
  ninguna presunción legal universal (opt-in simple vs. doble).
- Revocación: `user_request`, `manual_entry`, `written`, `verbal`. Siempre
  aceptada, incluso para contactos archivados, y crea una supresión
  `unsubscribed` (`source = consent_revocation`).
- Un re-consentimiento con `occurred_at` ≤ la última revocación se rechaza
  (`EMAIL_CONSENT_PREDATES_REVOCATION`).
- El estado vigente es el último evento del ledger por `ledger_position`.

### 3.5 Modelo de supresión

- Clave: `(organization_id, email_normalized)`, con índice único parcial para la
  supresión activa. Sobrevive al archivado del contacto y aplica a contactos
  creados después con la misma dirección.
- Motivos: `unsubscribed`, `hard_bounce`, `complaint`, `manual`,
  `invalid_address`, `legal_request`.
- Reglas para levantar (solo founder/admin, motivo de 10–1000 caracteres):
  - `complaint` y `legal_request`: **no levantables** en V1.
  - `unsubscribed`: requiere un consentimiento `granted` que ocurrió **y** se
    registró después de la supresión y que sigue siendo el último evento.
  - resto: permitido con motivo.
- El historial se conserva: una nueva supresión puede crearse tras un levantamiento.

### 3.6 Reglas de envío (`private.email_is_sendable`)

Se evalúan en este orden; el primero que falla determina el resultado:

1. Argumentos válidos y propósito conocido → `INVALID_REQUEST`
2. Contacto existe en esa organización → `CONTACT_NOT_FOUND`
3. Contacto activo → `CONTACT_NOT_ACTIVE`
4. Dirección válida y consistente → `ADDRESS_INVALID`
5. Sin supresión activa para la dirección → `SUPPRESSED` (+ motivo)
6. Existe consentimiento → `CONSENT_MISSING`
7. El último evento es `granted` → `CONSENT_REVOKED`
8. Evidencia completa y vigente (`occurred_at` ≤ ahora) → `CONSENT_EVIDENCE_INCOMPLETE`
9. `SENDABLE`

### 3.7 Seguridad (RLS y grants)

- RLS activada en las cuatro tablas; solo políticas `SELECT`:
  `organization_id = current_user_organization_id() AND email_can('read')`.
- `authenticated` y `service_role`: solo `SELECT`. `anon`: nada.
- `private.email_can` tiene `EXECUTE` para `authenticated` (lo requieren las
  políticas); sin `USAGE` sobre `private`, no es invocable vía API.
- Ningún otro helper privado es ejecutable por roles de API.

## 3b. Increment 2 — Audiences (implementado, solo base de datos)

Migración: `supabase/migrations/20260927120000_email_marketing_v1_audiences.sql`.
No redefine ningún objeto del Increment 1. Único cambio aditivo sobre él:
`email_audit_log.entity_type` acepta `list`, `tag`, `custom_field`, `segment`, `crm_import`.

### Tablas

| Tabla | Propósito | Mutabilidad |
|---|---|---|
| `email_lists` / `email_tags` | Catálogo. Nombre único por organización entre activos (case-insensitive). | `active → archived` (terminal), nombre inmutable, sin borrado. |
| `email_list_members` / `email_contact_tags` | Pertenencia actual (contacto ↔ lista/tag). FKs compuestas. | Alta/baja vía RPC; historial en auditoría. |
| `email_custom_field_definitions` | Campos tipados: `text`, `number`, `boolean`, `date`, `select` (opciones). Clave única por organización para siempre. | Definición inmutable; solo archivable. |
| `email_contact_field_values` | Valor por contacto y campo, validado por tipo (trigger). | Vía RPC; `null` borra el valor. |
| `email_segments` | Definición `segment.v1` guardada, con `version`. | Cambios incrementan `version`; `archived` terminal. |
| `email_contact_crm_links` | Vínculo cliente CRM ↔ contacto, con `import_batch_id`. | Append-only. **Sin FK a `public.clients`** (no se toca el esquema CRM). |

### RPCs (todas `SECURITY DEFINER`, org/actor derivados en servidor)

| RPC | Acción `email_can` |
|---|---|
| `email_create_list`, `email_archive_list`, `email_add_list_members`, `email_remove_list_members` | `manage_contacts` |
| `email_create_tag`, `email_archive_tag`, `email_add_contact_tags`, `email_remove_contact_tags` | `manage_contacts` |
| `email_create_custom_field`, `email_archive_custom_field`, `email_set_contact_fields` | `manage_contacts` |
| `email_create_segment`, `email_update_segment`, `email_archive_segment` | `manage_contacts` |
| `email_preview_audience`, `email_preview_segment` | `read` |
| `email_import_contacts_from_crm` | `manage_contacts` |

Se reutilizan acciones existentes de `email_can` (sin redefinirla): sigue siendo founder/admin.
Operaciones por lotes: 1..1000 contactos (importación CRM: 1..500 clientes). Ids de otra
organización son indistinguibles de ids inexistentes.

### DSL `segment.v1`

```json
{ "version": "segment.v1", "match": "all" | "any", "rules": [ ... ] }   // 1..20 reglas
{ "type": "list",  "op": "in" | "not_in",  "list_id": "<uuid>" }
{ "type": "tag",   "op": "has" | "not_has", "tag_id": "<uuid>" }
{ "type": "field", "field": "locale|timezone|source|email_domain",
  "op": "eq|neq" (string) | "in|not_in" (1..50 strings) | "is_null|is_not_null" }
{ "type": "custom_field", "key": "<key>", "op": ..., "value": ... }
   text: eq, neq, contains, in, not_in | select: eq, neq, in, not_in
   number/date: eq, neq, gt, gte, lt, lte | boolean: is_true, is_false
   todos: is_set, is_not_set
```

- Validación en servidor con claves permitidas por tipo de regla; errores
  `EMAIL_INVALID_SEGMENT` con detalle `rule N: motivo`.
- Referencias (listas, tags, campos) deben pertenecer a la organización del llamador.
- Evaluación interpretada (sin SQL dinámico); solo contactos `active` pueden coincidir.
- Semántica de ausencia: un valor ausente solo cumple `neq`, `not_in`, `is_null`/`is_not_set`.

### Preview

Devuelve `matched`, `sendable`, `not_sendable_by_reason` (usando
`private.email_is_sendable`, fail-closed) y una muestra de hasta 50 contactos.
No crea snapshots ni envía nada.

### Importación CRM

- Acción explícita sobre ids de `public.clients` de la organización activa.
- Crea contactos con `source = 'import'` (vía `email_create_contact`) o vincula
  contactos existentes; omite clientes sin email, con email inválido o cuyo
  contacto está archivado.
- **Nunca registra consentimiento** (`consent_recorded: false`): los contactos
  importados no son enviables hasta registrar evidencia con `email_record_consent`.
- Idempotente: un cliente ya vinculado cuenta como `already_linked`.

### UI

Diferida: requiere coordinar `src/App.jsx`, `Sidebar.jsx` y
`src/config/capabilities.js` con el trabajo de Codex sobre autorización en frontend.

## Increment 3a — Senders, templates y `email-content.v1` (implementado, solo base de datos)

> Nota de numeración: las secciones "3" y "3b" de arriba corresponden a los
> Increments 1 y 2. Esta sección es el **Increment 3a**; los sub-incrementos
> 3b (renderer), 3c (borradores de campaña) y 3d (runner Inc1–3 + Staging) se
> describen en el plan (§5).

Migración: `supabase/migrations/20260929120000_email_marketing_v1_senders_templates.sql`
(ASCII, aditiva). Sin renderer (3b), sin campañas (3c), sin proveedor, sin envío, sin DNS, sin UI.
Contrato SQL ↔ TS (hash, canonicalización, límites, orden, enteros, Unicode,
renderer): [`EMAIL_CONTENT_V1_CONTRACT.md`](./EMAIL_CONTENT_V1_CONTRACT.md).

### Cambios sobre objetos anteriores (ambos aditivos)

- `private.email_can` gana exactamente tres acciones: `manage_senders`,
  `manage_content`, `manage_campaigns` (esta última se usará en 3c; se añade
  ahora para que el fingerprint de `email_can` cambie una sola vez). Roles
  (founder/admin), derivación de tenant y todas las acciones existentes quedan
  idénticos; el test compara la matriz completa usuario × acción antes/después.
  `CREATE OR REPLACE` conserva owner y ACL (se reafirman explícitamente).
- `email_audit_log.entity_type` acepta `sender_domain`, `sender_identity`,
  `template`, `template_version`.

Ningún otro objeto de Inc1–2 cambia (fuente, definer, config, ACL, owner,
políticas, grants, constraints, triggers e índices se comparan antes/después).

### Impacto en el acceptance runner (cambio deliberado de fingerprint)

El runner Inc1–2 permanece congelado; ejecutado sobre una base con Inc3a
reportaría estas diferencias **esperadas**, que el runner Inc1–3 (3d) debe
reflejar explícitamente:

| Check | Inc1–2 | Tras Inc3a |
|---|---|---|
| ENV-06 fingerprint Inc1 | `bea78511eb8edb8959f98dd7e835cc3b` | `5615988a559e786c49aa88097238c72e` (solo cambia `email_can`) |
| ENV-07 fingerprint Inc2 | `a5c722084c60b6e4fe82eb57d0130b0c` | sin cambio |
| ENV-08 tablas `email_*` | 12 | 16 |
| ENV-09 funciones `email_*` | 51 | 81 (21 privadas + 9 RPC) |
| SEC-06 / SEC-07 RPCs públicas | 24 | 33 |
| SEC-08 helpers privados ejecutables | solo `email_can` | sin cambio |

Nota: el fingerprint usa `pg_get_function_identity_arguments`, que renderiza
tipos compuestos según `search_path` (`email_contacts` vs
`public.email_contacts`). Los valores de Staging corresponden a un
`search_path` sin `public`; el runner Inc1–3 debe fijar `search_path` antes de
calcularlo. Los tests locales ya lo hacen y reproducen los valores de Staging.

### Tablas

| Tabla | Propósito | Mutabilidad |
|---|---|---|
| `email_sender_domains` | Dominio desde el que la organización pretende enviar. Nombre DNS ASCII/punycode en minúsculas con el mismo patrón de dominio que Inc1 y ≤ 252 caracteres: el máximo utilizable (`a@` + 252 = 254, límite de dirección RFC 5321); un nombre DNS de 253 nunca podría enviar y se rechaza. | Ciclo de catálogo (guard de Inc2). `verification_status` solo admite `unverified` (CHECK + inmutable): los estados de verificación están reservados. Único por organización entre activos; dos organizaciones pueden registrar el mismo dominio sin verificar (la verificación futura decide propiedad). No archivable con identidades activas (`EMAIL_SENDER_DOMAIN_IN_USE`). |
| `email_sender_identities` | Remitente `local_part@dominio`, `from_name`, `reply_to`. FK compuesta al dominio. | Dirección inmutable; `from_name`/`reply_to` editables con `version` optimista. `from_name` sin el conjunto prohibido del contrato, sin `<>"\@` y sin *encoded words* RFC 2047 (`=?`) (anti header injection y spoofing). |
| `email_templates` | Contenedor con nombre único entre activos y `latest_version`. | Nombre/descripción inmutables; `latest_version` solo avanza +1 hacia una versión existente. |
| `email_template_versions` | Versión `email-content.v1` + `subject` + `preheader` + `content_sha256` + `merge_tag_count`/`merge_tags_sha256`. | **Append-only para todo rol.** Numeración consecutiva bajo lock; hash y evidencia de merge tags siempre recalculados en servidor; contenido revalidado en el guard BEFORE INSERT (frontera autoritativa para toda vía); `created_by` = actor de sesión cuando existe. |

### RPCs

| RPC | Acción `email_can` | Idempotencia / concurrencia |
|---|---|---|
| `email_create_sender_domain(domain)` | `manage_senders` | Repetir devuelve el activo (`was_created=false`). Los tres *create* idempotentes reintentan como máximo 3 veces si la fila en conflicto se archiva entre el conflicto y la búsqueda; después, `40001 EMAIL_CONCURRENT_MODIFICATION` (reintentable). Nunca devuelven cero filas. |
| `email_archive_sender_domain(id)` | `manage_senders` | Idempotente; `FOR UPDATE`. |
| `email_create_sender_identity(domain_id, local_part, from_name, reply_to)` | `manage_senders` | Mismo payload → existente; distinto → `EMAIL_SENDER_IDENTITY_CONFLICT`. Dominio `FOR SHARE` (serializa con archivado). |
| `email_update_sender_identity(id, changes, expected_version)` | `manage_senders` | `from_name`, `reply_to`; `EMAIL_SENDER_IDENTITY_VERSION_CONFLICT`; no-op no incrementa. |
| `email_archive_sender_identity(id)` | `manage_senders` | Idempotente. |
| `email_create_template(name, description)` | `manage_content` | Repetir devuelve el activo. |
| `email_archive_template(id)` | `manage_content` | Idempotente. |
| `email_create_template_version(template_id, subject, preheader, content, expected_latest_version)` | `manage_content` | `expected_latest_version` **obligatorio**. Contenido idéntico a la última versión → la devuelve (`was_created=false`), incluso con expected obsoleto (reintento) y aunque el estado referenciado haya cambiado (p. ej. campo archivado): la comprobación de reintento exacto va antes de la validación. Todo contenido nuevo se valida completo. Si no, expected obsoleto → `EMAIL_TEMPLATE_VERSION_CONFLICT` (40001). El trigger bloquea `FOR SHARE` los campos personalizados referenciados (serializa con `email_archive_custom_field`). |
| `email_validate_content(subject, preheader, content)` | `read` | Solo lectura; devuelve `{valid, content_sha256, block_count, merge_tags}` o `{valid:false, error, detail}`. |

### `email-content.v1`

```json
{ "version": "email-content.v1", "blocks": [ ... ] }      // 1..100 bloques, <= 65536 bytes
{ "type": "heading",   "level": 1..3, "text": "..." }        // 1..300, una línea
{ "type": "paragraph", "text": "..." }                        // 1..5000, admite \n
{ "type": "button",    "text": "...", "url": "https://..." | "mailto:..." }
{ "type": "image",     "src": "https://...", "alt": "...", "href"?: url, "width"?: 1..600 }
{ "type": "divider" }
{ "type": "spacer",    "height": 4..96 }
```

- Texto plano: nunca se interpreta como HTML; secuencias tipo etiqueta
  (`<p`, `</`, `<!--`, `< script`) se rechazan, también con cada merge tag
  sustituido por una letra (`<{{contact.first_name|script}}>` se rechaza).
  `5 < 6` es válido. Los **valores** sustituidos no se validan aquí: son no
  confiables; el renderer escapa por contexto **todo** texto, de plantilla y
  sustituido (contrato §7).
- URLs: `https://` con host ASCII (sin userinfo, sin IP, sin comillas,
  espacios, `\`, `<>`, `{}`); `mailto:` con una sola dirección, sin query.
  Imágenes: solo `https://`. Merge tags **nunca** en URLs ni en `alt`.
- Merge tags `{{ ruta }}` / `{{ ruta | fallback }}` en subject, preheader y
  texto de bloques. Rutas: `contact.first_name`, `contact.last_name`,
  `contact.email`, `organization.name`, `custom.<key>` (campo activo de la
  organización). `{{{`/`}}}` rechazados (no hay salida "raw").
- Subject 1..200 y preheader 1..250 (code points): una línea, sin caracteres
  del conjunto prohibido, sin HTML crudo y sin *encoded words* (`=?`). Los
  campos de encabezado (`from_name`, subject, preheader) rechazan además los
  selectores de variación ideográfica U+E0100–U+E01EF (regla V1 fail-closed);
  el cuerpo los conserva para variantes CJK legítimas. Permitidos en todos los
  campos (encabezados incluidos): ZWNJ/ZWJ (U+200C, U+200D) y U+FE00–U+FE0F
  (emoji y variantes estándar). La regla de encabezado se aplica también al
  **valor final renderizado** (tras sustituir merge tags): el renderer (3b)
  debe comprobar subject y preheader finales con
  `private.email_rendered_header_is_safe` (misma autoridad SQL) y fallar
  cerrado con `RENDER_UNSAFE_HEADER`; nunca elimina caracteres en silencio
  (contrato §7.1, paso 4). Nombres y descripciones de plantilla usan el mismo
  conjunto explícito, validado en la propia RPC `email_create_template` (sin
  los helpers `[[:cntrl:]]` de Inc2, cuyo resultado depende del locale). La
  independencia del locale se limita a la **validación de caracteres**: la
  unicidad de nombres usa `name_normalized = lower(name)`, que sigue
  dependiendo del locale/collation de la base (mismo patrón que Inc2); qué
  nombres no ASCII cuentan como duplicados puede variar entre PGlite (`C`) y
  Staging. Rediseñar la normalización es **DEFER WITH REASON**: decisión
  transversal a todos los nombres de Email (Inc1–3), fuera de V1. La
  lista normativa de caracteres prohibidos vive **solo** en
  [`EMAIL_CONTENT_V1_CONTRACT.md`](./EMAIL_CONTENT_V1_CONTRACT.md) §3; un test
  estático exige que coincida exactamente con la expresión SQL y su comentario.
  Anti header injection y spoofing.
- Errores: `22023 EMAIL_INVALID_CONTENT`, detalle `"<ubicación>: <motivo>"`.
- Vectores compartidos (válidos e inválidos, con detalle exacto):
  `supabase/tests/fixtures/email_content_v1_cases.json`. El renderer TS (3b)
  debe consumir los mismos vectores para que SQL y TS no diverjan.

### Auditoría

`email.sender_domain.created|archived`, `email.sender_identity.created|updated|archived`,
`email.template.created|archived`, `email.template_version.created`
(`template_id`, `version_number`, `content_sha256`, `block_count`,
`merge_tag_count`, `merge_tags_sha256`: evidencia acotada, nunca la lista,
guardada también como columnas inmutables de la versión; y `created_by`).
- La creación de versiones se audita en el trigger `AFTER INSERT`
  (`email_template_versions_advance`), fuente única y autoritativa: solo filas
  realmente insertadas, cada una exactamente una vez, por cualquier vía
  permitida. Una inserción omitida por `ON CONFLICT DO NOTHING` no deja
  versión ni auditoría.
- Actor autoritativo = actor de sesión (`auth.uid()`). Si existe, el guard
  exige `created_by = auth.uid()` (`EMAIL_ACTOR_MISMATCH`), así que actor y
  autor nunca discrepan. Sin actor de sesión (vía owner/mantenimiento) la
  auditoría registra actor `system` y conserva `created_by` como evidencia.
- Cambios de `reply_to`: `reply_to_hash` (hash de la nueva dirección) o
  `reply_to_cleared`.
- Direcciones solo como hash SHA-256; nunca subject, preheader ni contenido.
  Los reintentos idempotentes no se auditan de nuevo.

### Recuperación (solo Staging)

`supabase/recovery/20260929120000_email_marketing_v1_senders_templates.down.sql`:
una transacción que elimina todos los objetos de 3a, restaura `email_can`
byte a byte (fingerprint `bea78511…`) y el CHECK de `entity_type` de Inc2, y
borra la fila del historial de migraciones. Fija `lock_timeout = 10s` y toma
los locks en este orden fijo: `supabase_migrations.schema_migrations`
(`EXCLUSIVE`, si existe; evita el TOCTOU entre leer el historial y borrar la
fila: ninguna migración puede registrarse mientras tanto), las tablas de 3a
(`ACCESS EXCLUSIVE`) y `email_audit_log` (`EXCLUSIVE`). Si algún lock no se
obtiene en 10 s, la transacción aborta sin cambios (`55P03`; si el cliente
continúa, la sentencia destructiva detecta el lock ausente y rechaza) y el
operador reintenta. Falla cerrado si el historial registra cualquier migración
posterior a `20260929120000` (`EMAIL_RECOVERY_REFUSED_LATER_MIGRATION`) o
cualquier versión fuera de la **línea base de recuperación revisada**
(`EMAIL_RECOVERY_REFUSED_UNKNOWN_MIGRATION`, p. ej. una migración de versión
menor aplicada después); si el estado no es exactamente el inventario de 3a
(`EMAIL_RECOVERY_REFUSED_UNEXPECTED_STATE`): `email_can`, el CHECK de
`entity_type`, el conjunto de relaciones y funciones `email_*`, y las columnas,
triggers, políticas e índices de las tablas de 3a, además de ninguna función
ajena a 3a que referencie sus tablas, llame a sus funciones o use las acciones
`manage_senders|manage_content|manage_campaigns`, y ninguna política que use
esas acciones (tras la recuperación negarían a todos en silencio); además,
vía `pg_depend`: ningún objeto ajeno a 3a puede depender de sus tablas, tipos
de fila o funciones (vistas, FKs, políticas, defaults, triggers, funciones
`BEGIN ATOMIC`), y ninguna vista/materializada, regla, default de columna,
CHECK, cláusula `WHEN` de trigger o función atómica que dependa de
`email_can` o de `email_require` (helper de Inc1 que pasa la acción a
`email_can`) puede usar esas acciones (se inspecciona su definición
deparseada por PostgreSQL, las funciones atómicas vía `pg_get_functiondef`;
solo se compara el literal de la acción, que el deparseo nunca cualifica, así
que no depende de `search_path`; un tipo de dependiente desconocido también
rechaza). Límites documentados: índices por expresión y columnas generadas
no pueden llamar a `email_can` (no es inmutable); una acción calculada en
tiempo de ejecución (`'manage_' || x`) no es detectable; o si existe cualquier dato de 3a
(`EMAIL_RECOVERY_REFUSED_DATA_PRESENT`: la auditoría es inmutable y no se borra). Ensayado localmente (aplicar → recuperar
→ snapshot idéntico a Inc1–2 → re-aplicar). **Production es forward-fix.**

**Atomicidad independiente del cliente (HIGH-1, pass 10).** Toda modificación
la hace UNA sentencia final (`do $recovery$`): funciones y tablas de 3a, CHECK
de auditoría, `email_can` y la fila del historial; un fallo dentro de ella la
deshace entera. Esa sentencia rechaza
(`EMAIL_RECOVERY_REFUSED_INCOMPLETE_PRECONDITIONS`) salvo que en esta misma
transacción hayan pasado, en orden, todos los chequeos (cada uno registra su
éxito como última acción en `orvesen.email_inc3a_recovery`, local a la
transacción y reiniciado al inicio del script; un chequeo rechazado se
revierte junto con su registro) y que la sesión conserve todos los locks de
recuperación (verificado en `pg_locks`). Así, un cliente que revierte solo la
sentencia fallida y continúa (psql `ON_ERROR_ROLLBACK`, GUIs que vuelven a un
savepoint por sentencia) no cambia nada tras un rechazo; la corrección no
depende de que el cliente se detenga en el primer error. Defensa adicional:
con psql usar `-v ON_ERROR_STOP=1`, nunca `ON_ERROR_ROLLBACK`. Probado en
PGlite con un cliente que ejecuta cada sentencia en su propio savepoint y
continúa tras cada error, y en PostgreSQL 17 con `psql -v ON_ERROR_ROLLBACK=on`.

**Precondición operativa: EMAIL INC3A RECOVERY REQUIRES A MIGRATION/DDL
FREEZE.** Durante toda la ventana de recuperación: ninguna migración en curso,
ningún DDL que cambie el esquema, ningún cambio de esquema desde el SQL
Editor, y la automatización de migraciones/despliegues (CI, `supabase db
push`, despliegues de ramas) en pausa. El invariante de seguridad es
**freeze operativo + pre-check técnico + locks de recuperación**, no SQL por
sí solo. El pre-check (solo lectura de `pg_locks`, `pg_stat_activity` y
`pg_prepared_xacts`; nunca termina sesiones) se ejecuta antes de cualquier
lock y otra vez con todos los locks tomados (cada ejecución descarta antes
la copia de `pg_stat_activity` que PostgreSQL conserva hasta el final de la
transacción, con `pg_stat_clear_snapshot()`, así que la segunda lee la
actividad actual, aunque solo en ese instante), y rechaza con
`EMAIL_RECOVERY_REFUSED_CONCURRENT_ACTIVITY` si hay una transacción preparada;
**primero**, si otra sesión de esta base no es completamente visible para el
rol (`query = '<insufficient privilege>'` con `backend_type`/`state` NULL),
antes de cualquier filtro por esas columnas: la recuperación debe ejecutarse
con un rol que vea todas las sesiones (p. ej. miembro de
`pg_read_all_stats`) o rechaza; si algún lock (leído solo de `pg_locks`,
visible para cualquier rol) de otra sesión escribe o bloquea el historial de
migraciones o es un lock de tabla de nivel esquema (`SHARE UPDATE EXCLUSIVE`
o más fuerte), salvo que esa sesión sea visible como `autovacuum worker`; o
si otra sesión visible en transacción ejecuta como sentencia actual o última
SQL que cambia el esquema. El
`lock_timeout` de 10 s se mantiene. **Limitación residual:** SQL no puede
detectar ni serializar por completo DDL arbitrario no confirmado que ya se
ejecuta en otra sesión (sus filas de catálogo son invisibles, `CREATE
FUNCTION` no retiene locks de tabla, el DDL anterior de una transacción
inactiva no es visible tras otra sentencia, y una sesión puede empezar DDL
tras el último chequeo). El freeze es lo que cierra ese hueco. En PGlite
(una sola conexión) la segunda sesión se simula tratando la propia sesión
como ajena, sustituyendo solo su pid (el resto de filtros sigue activo): lock
de DDL en curso, escritura del historial, re-chequeo con los locks tomados, y
sesión no visible reproducida con `SET ROLE` a un rol sin privilegios (fila
con `backend_type`/`state` NULL e `'<insufficient privilege>'`), incluido su
lock; es comportamiento del motor PostgreSQL 18 en un único backend, no una
prueba multi-sesión. El predicado de texto de sentencias que cambian el
esquema se evalúa en PostgreSQL contra ejemplos positivos y negativos
(el texto de la propia sesión es el lote enviado, truncado a
`track_activity_query_size`, por lo que no sirve para simular otra sesión;
la frescura del re-chequeo sí se prueba enviando el script en dos lotes de
la misma transacción); las transacciones preparadas solo se verifican estáticamente
(`max_prepared_transactions = 0` en PGlite).

Línea base de recuperación revisada. La lista de versiones aceptadas (entre
`-- BEGIN/END REVIEWED RECOVERY BASELINE`) se genera desde
`supabase/tests/fixtures/email_marketing_v1_recovery_baseline.json`. Es un
snapshot de **tiempo de build**: no garantiza ser el historial en el momento de
aplicar. **Regla operativa:** inmediatamente antes de aplicar 3a a un entorno
real, exportar su historial (`select version, name from
supabase_migrations.schema_migrations order by version;`), revisarlo,
guardar sus filas **anteriores a 3a** como ese fixture, regenerar la lista con
`node supabase/tests/email_marketing_v1_recovery_baseline.mjs --write` y
actualizar el digest fijado `RECOVERY_BASELINE_SHA256` que imprime.
Ciclo de vida:
- **Antes de registrar 3a:** la cobertura se exige solo para versiones
  menores que 3a; una versión menor desconocida o retro-fechada falla cerrada
  hasta refrescar y revisar la línea base.
- **Después de registrar 3a:** la línea base queda **congelada** (`--write`
  se niega). Las migraciones posteriores no requieren editarla: las gobiernan
  `EMAIL_RECOVERY_REFUSED_LATER_MIGRATION` y las reglas de orden. Una versión
  menor que 3a fuera de la línea base es una migración retro-fechada: falla y
  debe revertirse, nunca añadirse. Una línea base con versiones ≥ 3a, filas
  desordenadas, o que no coincide con el digest fijado (editada, truncada o
  con una versión absorbida) falla; también falla si una fila revisada falta
  en el historial o cambió de nombre.

`--check` y el validador estático fallan si la lista difiere del fixture, si
el digest no coincide o si el historial actual viola el ciclo de vida. El
ensayo prueba ambos lados: con la línea base obsoleta una migración paralela
legítima provoca rechazo; tras refrescarla se acepta; una versión desconocida
sigue siendo rechazada.

### Decisión diferida (L5)

- `email_update_sender_identity` mantiene `p_expected_version` opcional, igual
  que `email_update_contact` y `email_update_segment` (Inc1–2): un cliente que
  lo omite puede sobrescribir en silencio. Hacerlo obligatorio en todo el
  dominio es una decisión de API transversal, diferida.
- Validación de una versión nueva: **dos** pasadas, ambas con propósito.
  (1) `email_create_template_version` valida antes de la comprobación de
  conflicto de versión: fija la precedencia de errores de la API (un contenido
  inválido se informa como `EMAIL_INVALID_CONTENT` aunque `expected` esté
  obsoleto). No es una frontera de seguridad. (2) `email_template_versions_guard`
  (BEFORE INSERT) es la **frontera autoritativa** para toda vía de inserción y
  además produce la lista de merge tags que se bloquea y re-comprueba. Hasta
  Fix Pass 3 existía una tercera pasada en el trigger AFTER, usada solo para
  contar y hashear merge tags para la auditoría: era redundante (la fila es
  inmutable y el guard ya la validó con los campos bloqueados) y se eliminó; el
  guard guarda ahora `merge_tag_count`/`merge_tags_sha256` en la fila y el
  trigger AFTER los lee. Quitarla no cambia bloqueos ni garantías de carrera
  (los `FOR SHARE` se toman en el guard). Comprobado por un mutante: sin la
  validación del guard, las inserciones directas inválidas se aceptarían y la
  suite de inmutabilidad lo detecta.
- **Lows diferidos de la octava revisión (Pass 8, pendientes):** L1 no se
  comprueban locks de objeto/namespace del DDL sin lock de tabla; L2 el regex
  de texto DDL no ve `DO`/`EXECUTE`/`CALL` y el texto puede truncarse
  (`track_activity_query_size`); L3 la comprobación de referencias en
  `prosrc` distingue mayúsculas; L4 la congelación de `--write` depende del
  fixture del repositorio, no del historial vivo; L5 la allowlist SQL compara
  solo versiones; L6 subida no documentada `EXCLUSIVE` → `ACCESS EXCLUSIVE`
  en `email_audit_log` tras los chequeos (sigue fallando cerrado); L7
  etiquetas "build-time"/"authoritative" obsoletas en fixtures.
- **DEFER V1 — lista de tipos de bloque duplicada / re-parseo.** Los tipos de
  bloque (`heading`, `paragraph`, `button`, `image`, `divider`, `spacer`)
  aparecen en más de una función SQL y el contenido se recorre más de una vez
  al validar. Motivo: unificarlo exige reestructurar el validador autoritativo
  (riesgo de regresión en la frontera de seguridad) sin beneficio funcional en
  V1; el coste es acotado (≤ 100 bloques, ≤ 65536 bytes). Guard existente: un
  test estático exige que los tipos de bloque con texto que valida
  `email_content_validate` sean exactamente los que re-comprueba (y bloquea)
  `email_template_versions_guard` (`heading`, `paragraph`, `button`), así que
  un tipo con texto añadido en un sitio y no en el otro falla.

## 4. State machines

### Contact (Increment 1)
`active → archived` (terminal). Rechazado: `archived → active`, cambios de
identidad, borrado, inserción en estado distinto de `active`.
Futuro: `erased` (borrado de PII conservando la supresión como hash).

### Consent (ledger)
Eventos inmutables `granted` / `revoked`. Estado = último evento.
Futuro: `confirmation_requested` / `confirmed` para doble opt-in.

### Suppression
`active → lifted` (una vez, con motivo). Rechazado: reactivar, editar, borrar.

### Diseñadas para incrementos futuros
- **Campaign:** `draft → pending_approval → approved → scheduled → sending → sent`,
  con `paused`, `cancelled` y `archived`. Editar contenido/audiencia desde
  `pending_approval` invalida la aprobación; `sent` es inmutable.
- **Sequence:** `draft → active ⇄ paused → archived`; editar crea una versión nueva.
- **Enrollment:** `active → … → completed | exited | failed`; una activa por (secuencia, contacto).
- **Send Job:** `pending → ready → in_flight → accepted | retry_wait | failed | needs_reconciliation`,
  más `skipped_suppressed` / `cancelled`; `delivery_outcome` separado alimentado por eventos.
- **Delivery Attempt:** `started → accepted | transient_failure | permanent_failure | unknown` (inmutable).
- **Email Event:** `received → verified → applied | duplicate | ignored | failed` (append-only).

## 5. Plan incremental

1. **Foundation & Safety Core** ✅ (aplicado y validado en Staging).
2. **Audiences** ✅ base de datos (listas, tags, custom fields, segmentos `segment.v1`, preview, importación CRM sin consentimiento). UI diferida hasta coordinar archivos compartidos.
3. Sender domains/identities (sin DNS real), templates y versiones inmutables, renderer TS con escaping, borradores de campaña. Dividido internamente en:
   **3a** senders + templates/versiones + validación `email-content.v1` (implementado, pendiente de revisión/Staging);
   **3b** renderer TS + vectores compartidos; **3c** borradores de campaña + readiness;
   **3d** runner de aceptación Inc1–3 y Staging.
4. Provider abstraction + adaptador `sandbox` + suite de contrato.
5. Autorización de envío (hash de contenido + audiencia, aprobador humano), snapshot de audiencia, send jobs, dispatcher, rate limiting, reintentos. **Decisión pendiente: `pg_net` + Vault vs. cron externo.**
6. Webhooks (firma + anti-replay), inbox deduplicado, unsubscribe público (token HMAC, RFC 8058), automatización de supresión; después, primer proveedor real detrás de un flag.
7. Métricas, guardrails (auto-pausa por quejas/rebotes), conversiones y atribución (`last_click` 7 días).
8. Motor de secuencias.
9. Contratos Orb / Goal Engine y acceso de miembros por `module_key` (tras integrar el `member_module_access` por organización de Codex).

## 6. Contratos futuros (no implementados)

- **Orb** (forma `orb-capability.v1`): `email.campaign.create_draft`,
  `email.audience.preview`, `email.sequence.create_draft`,
  `email.campaign.request_send_authorization`, `email.performance.inspect`.
  Orb **nunca** aprueba envíos.
- **Goal Engine:** observaciones `source_type='adapter'`,
  `source_name='orvesen.email'`, `ingestion_identity='email:<org>:<campaign>:<metric>:<window>'`.
- **CRM (`clients`):** enlace opcional contacto ↔ cliente; importación explícita.
- **Ventas:** `email_record_conversion(...)` idempotente, solo servidor.
- **Builder:** captura de formularios vía `email_capture_contact(...)` con evidencia de consentimiento.
- **Score:** vista de evidencia de campañas de solo lectura.

## 7. Límites entre agentes

No modificar desde este dominio: migraciones existentes, `member_module_access`,
`handle_new_user`, `orb_action_proposals`, `supabase/functions/orb-chat/**`,
`src/features/builder/**`, `src/features/orb/**`, `AuthContext.jsx`,
`Settings.jsx`, `settings/**`, `MemberAdminService.js`, `OrbService.js`,
esquema/servicios de `clients`, `.env*`, `package.json`, `package-lock.json`.

Puntos compartidos a coordinar en incrementos con UI: `src/App.jsx`,
`Sidebar.jsx`, `src/config/capabilities.js`.

## 8. Tests

```bash
# Contratos estáticos (sin dependencias)
node supabase/tests/validate_email_marketing_v1_foundation.mjs

# Integración (PGlite efímero; no se añade a package.json)
npx -y -p @electric-sql/pglite node supabase/tests/email_marketing_v1_foundation.integration.mjs

# Increment 2
node supabase/tests/validate_email_marketing_v1_audiences.mjs
npx -y -p @electric-sql/pglite node supabase/tests/email_marketing_v1_audiences.integration.mjs

# Increment 3a
node --test supabase/tests/validate_email_marketing_v1_senders_templates.mjs
npx -y -p @electric-sql/pglite node --test supabase/tests/email_marketing_v1_senders_templates.integration.mjs
# Ensayo de recuperación (aplicar -> recuperar -> contratos Inc1-2 idénticos)
npx -y -p @electric-sql/pglite node --test supabase/tests/email_marketing_v1_senders_templates.recovery.mjs
# Mutation (sabotage) runner: cada defecto declara su clase de detección
# (behavioral = debe fallar un test de integración relevante; static-only = con motivo)
npx -y -p @electric-sql/pglite node supabase/tests/email_marketing_v1_senders_templates.mutation.mjs
```

La integración de 3a carga Inc1+Inc2, toma snapshots de todos sus objetos,
aplica 3a y verifica que nada existente se debilitó, además de reproducir los
fingerprints del runner de Staging.

Orden de migraciones (`supabase/tests/email_marketing_v1_migration_order.mjs`).
Fuentes y su autoridad:

| Fuente | Autoritativa para |
|---|---|
| La cadena Email del repositorio (Inc1 → Inc2 → Inc3a) | Qué migraciones Email existen y en qué orden. |
| `supabase/tests/fixtures/email_marketing_v1_staging_history.json` | Snapshot **actual** (refrescable) de lo **aplicado** en Staging (export de solo lectura de `supabase_migrations.schema_migrations`). Las invariantes deben cumplirse con cualquier refresco: sin conteos de filas ni supuestos sobre qué incrementos están aplicados. |
| `supabase/tests/fixtures/email_marketing_v1_staging_history_2026-09-29.json` | Snapshot **histórico inmutable** (77 filas, Inc1+Inc2, Inc3a aún no aplicada) con el que se construyó 3a. Solo aserciones históricas y el conjunto de versiones que acepta la recuperación de 3a. |
| Ramas paralelas (listadas en los fixtures como evidencia) | Migraciones legítimas: 8 de goal-engine de Codex (`20260921…`–`20260924…`, anteriores a Inc1, no aplicadas en Staging) y 5 de baseline aplicadas en Staging pero ausentes de este worktree. |

Reglas (idénticas en los validadores de Inc1, Inc2 e Inc3a, cada uno para sus
incrementos):
1. cada incremento existe exactamente una vez y las versiones crecen en orden;
2. prefijos de versión únicos en **todas** las migraciones;
3. ninguna migración Email fuera de la cadena ordena antes del último
   incremento (un único predicado: nombre que empieza por `email_marketing_`,
   igual para archivos y filas del historial);
4. **ventana protegida aplicada**: entre el primer incremento y el **último
   incremento registrado en Staging**, toda migración debe estar ya aplicada;
   una no aplicada ahí es retro-fechada (se aplicaría fuera de orden). Un
   incremento pendiente no amplía la ventana: una migración paralela legítima
   fechada antes de un incremento pendiente pasa. Las intercaladas ya
   aplicadas son historia legítima;
5. historial: las migraciones Email registradas son exactamente un prefijo de
   la cadena, y todo incremento pendiente ordena después de la última versión
   registrada.
Las migraciones anteriores a Inc1 no quedan restringidas. Casos sintéticos
(historiales hasta Inc2, Inc3a y un Inc4 futuro; migraciones paralelas reales)
prueban que no hay falsos fallos y que se detectan predecesores ausentes o
reordenados. Los validadores de Inc1 e Inc2 usan estas reglas (únicas
modificaciones a tests existentes de Inc1–2, limitadas a su prueba de orden).

Concurrencia: PGlite es de una sola conexión y usa collation `C`. Las carreras
se simulan de forma determinista (triggers de sentencia solo de test que
archivan la fila en conflicto justo entre el conflicto y la búsqueda, y que
fuerzan el agotamiento de reintentos), además de versiones obsoletas y
reintentos. Los locks (`FOR UPDATE`/`FOR SHARE`) y el orden por collation `C`
se verifican estáticamente. **Nada de esto prueba concurrencia real**; el
runner Inc1–3 en Staging (3d) es la siguiente capa de evidencia.

Finales de línea: con `core.autocrlf=true` un checkout nuevo en Windows tiene
CRLF. Todas las suites (Inc1, Inc2, Inc3a, recuperación, mutation runner) leen
texto con `readText` (CRLF y CR sueltos → LF) y los hashes de fuente se
calculan sobre el texto normalizado; el mutation runner incluye un control
CRLF. No se añade `.gitattributes` para no reescribir finales de línea en todo
el repositorio.

Módulo compartido de harness para 3a en adelante:
`supabase/tests/email_marketing_v1_harness.mjs` (las suites de Inc1–2 no se tocan).

La prueba de integración simula el entorno de Supabase (roles, `auth.uid()`,
privilegios por defecto amplios) y verifica aislamiento entre dos
organizaciones, roles, DML prohibido, inmutabilidad, consentimiento,
supresión, sendability e idempotencia.
