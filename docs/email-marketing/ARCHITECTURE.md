# ORVESEN Email Marketing — Arquitectura

Estado: Increment 1 aplicado y validado en Staging (Email Domain Foundation &
Safety Core). Increment 2 (Audiences) implementado, solo base de datos, pendiente
de Staging.
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
3. Sender domains/identities (sin DNS real), templates y versiones inmutables, renderer TS con escaping, borradores de campaña.
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
```

La prueba de integración simula el entorno de Supabase (roles, `auth.uid()`,
privilegios por defecto amplios) y verifica aislamiento entre dos
organizaciones, roles, DML prohibido, inmutabilidad, consentimiento,
supresión, sendability e idempotencia.
