# Contrato `email-content.v1` (SQL ↔ TS)

Estado: normativo desde Increment 3a. El renderer TS (Increment 3b) y cualquier
consumidor posterior (dispatcher, Orb) **consumen** este contrato; no definen
uno propio. Si una regla necesita cambiar, cambia aquí, en la migración y en
los vectores compartidos a la vez.

Vectores compartidos: `supabase/tests/fixtures/email_content_v1_cases.json`.
Implementación de referencia: `private.email_content_validate` y funciones
asociadas en `supabase/migrations/20261004150000_email_marketing_v1_senders_templates.sql`.

## 1. Autoridad

| Aspecto | Autoridad | Regla para TS |
|---|---|---|
| Validez de una versión guardada | PostgreSQL (`email_template_versions_guard`) | Una versión existente ya es válida; TS no la revalida para decidir si se envía. |
| `content_sha256` | **Solo PostgreSQL** | TS nunca calcula ni compara este hash para autorizar nada; si lo necesita, lo lee de la base. |
| Representación canónica JSON | `jsonb` de PostgreSQL | TS trabaja con el contenido tal como lo devuelve la base. |
| Límite de 65536 bytes | PostgreSQL (`octet_length(content::text)`) | TS puede avisar antes, pero no decide. |
| Veredicto de validación de borradores | PostgreSQL (`email_validate_content`) | Una prevalidación TS debe coincidir en los casos `parity: "exact"`. |

## 2. Hash (`content_sha256`)

```
sha256( UTF-8( jsonb_build_object('subject', S, 'preheader', P, 'content', C)::text ) )  -> hex minúsculas
```

- `S` = subject recortado de espacios U+0020; `P` = preheader recortado o `null` si queda vacío; `C` = contenido `jsonb`.
- `jsonb::text` es la forma canónica de PostgreSQL: claves ordenadas por
  longitud y después por bytes, separadores `", "` y `": "`, claves duplicadas
  resueltas con la última, números con su forma textual `numeric` (`1.0` ≠ `1`;
  `1e2` se guarda como `100`). **No es RFC 8785 (JCS)** y no se replica en TS.
- Cada caso válido de los vectores fija su `content_sha256` esperado: detecta
  cualquier cambio de canonicalización (p. ej. al actualizar PostgreSQL).
- La autorización de envío (Increment 5) hará hash en la base, nunca en TS.

## 3. Texto, longitudes y Unicode

- Longitudes en **code points** (`char_length`). TS debe contar code points
  (`[...s].length`), nunca unidades UTF-16 (`s.length`). Vectores: 200/201 y
  300/301 code points astrales.
- Sin normalización Unicode: NFC y NFD son contenidos (y hashes) distintos.
- Conjunto de caracteres prohibidos (explícito, independiente del locale;
  lista normativa, idéntica a `private.email_text_has_unsafe_chars`):
  U+0001–U+001F (LF permitido solo en `paragraph`), U+007F–U+009F, U+00AD,
  U+034F, U+061C, U+115F–U+1160, U+17B4–U+17B5, U+180B–U+180F, U+200B,
  U+200E–U+200F, U+2028–U+202E, U+2060–U+206F, U+2800, U+3164, U+FEFF,
  U+FFA0, U+FFF0–U+FFFB, U+1BCA0–U+1BCA3, U+1D173–U+1D17A,
  U+E0000–U+E00FF (caracteres *tag* y *default-ignorable* reservados; esto
  también rechaza los emoji de banderas de subdivisión: limitación aceptada
  en V1), U+E01F0–U+E0FFF (*default-ignorable* reservados).
  Un test estático compara esta lista con la expresión SQL y su comentario:
  cualquier divergencia pone la suite en rojo.
- **Campos de encabezado** (`from_name`, subject, preheader) rechazan
  además U+E0100–U+E01EF (selectores de variación ideográfica). Regla V1 fail-closed, sin
  excepción contextual (`private.email_text_has_header_unsafe_chars`;
  paridad comprobada por un test estático). Se aplica al texto de la
  plantilla **y al valor final renderizado** (§7.1 paso 4).
- **Permitidos en todos los campos** (encabezados incluidos): ZWJ y ZWNJ
  (U+200C, U+200D; secuencias de emoji) y los selectores de presentación de
  emoji U+FE00–U+FE0F.
- **Permitidos solo en el cuerpo** (texto de bloques, nombres y descripciones
  de plantilla): los selectores de variación ideográfica U+E0100–U+E01EF
  (eligen variantes legítimas de glifos CJK, p. ej. en nombres propios
  japoneses). **Son invisibles y pueden transportar una carga oculta** (p. ej.
  para consumidores LLM como Orb): riesgo residual aceptado solo en el cuerpo
  en V1; cualquier consumidor automático debe tratarlo como texto no
  confiable. Se revisará si aparece abuso.
- HTML: el texto es texto plano. Se rechaza cualquier `<` seguido (tras
  espacios/LF opcionales) de letra, `!`, `/` o `?`, también **después de
  sustituir cada candidato de merge tag por una letra** (no se puede construir
  una etiqueta alrededor de un merge tag).

## 4. Enteros

Un entero válido es un número JSON cuya forma textual en `jsonb` coincide con
`^[0-9]{1,4}$` y cae en el rango. `1.0` se rechaza (forma textual `1.0`). Un
runtime JS no puede observar esa forma tras `JSON.parse` (`1.0 === 1`): esos
casos se marcan `parity: "db_only"` y la base es la autoridad.

## 5. Merge tags

- Sintaxis: `{{ ruta }}` o `{{ ruta | fallback }}`; candidatos = `\{\{[^{}]*\}\}`;
  tras quitarlos no puede quedar `{{` ni `}}`; `{{{`/`}}}` prohibidos.
- Rutas: `contact.first_name`, `contact.last_name`, `contact.email`,
  `organization.name`, `custom.<key>` (campo activo de la organización al
  guardar).
- Fallback: ≤ 100 code points tras `trim` de espacios, sin `|`, `<`, `>` ni
  caracteres prohibidos. En PostgreSQL `.` incluye LF: un fallback con LF se
  rechaza como *fallback inválido*; TS debe usar `[\s\S]` o el flag `s` para
  llegar al mismo veredicto.
- `merge_tags` devuelto = rutas distintas ordenadas **bytewise** (collation
  `C`). Para rutas ASCII equivale a `Array.prototype.sort()` de JS. Vector con
  claves `a1`, `a_z`, `ab`, cuyo orden difiere bajo la collation ICU
  `unicode` (verificado en la suite de integración).
- Nunca en URLs ni en `alt`.

## 6. Gramática exacta (paridad)

Para que una implementación TS alcance el mismo veredicto que SQL en los casos
`parity: "exact"`:

- **Recorte**: subject y preheader se recortan solo de espacios U+0020 en
  ambos extremos (`btrim` por defecto); un preheader que queda vacío pasa a
  `null`. El texto de los bloques **no** se recorta; debe contener algo distinto
  de U+0020 y LF.
- **Primer error**: se informa solo el primer error, con el detalle literal
  `"<ubicación>: <motivo>"` (ubicación `subject`, `preheader`, `content` o
  `block N`, N desde 1). Vectores con **varios errores simultáneos** fijan el
  orden (`multiple errors: …` en los vectores compartidos).
- **Orden global**: subject → preheader (si no es `null`) → contenido: objeto →
  tamaño (65536 bytes) → claves de primer nivel → `version` → `blocks` es array
  de 1..100 → cada bloque en orden.
- **Subject y preheader**: longitud (1..200 / 1..250, sin espacios U+0020 en
  los extremos) → caracteres prohibidos → HTML crudo (incluida la sonda con
  merge tags sustituidos) → *encoded words* (cualquier `=?`) → merge tags.
- **Cada bloque**: objeto → `type` string conocido → claves permitidas →
  campos en este orden:
  - `heading`: `level` → `text`.
  - `paragraph`: `text`.
  - `button`: `text` → `url`.
  - `image`: `src` → presencia de `alt` → `alt` string ≤ 300 → caracteres
    prohibidos en `alt` (LF incluido) → HTML crudo en `alt` → cualquier `{{`
    o `}}` en `alt` (incluso sueltos, p. ej. `a}}b`) → `href` (si existe) →
    `width` (si existe).
  - `spacer`: `height`.
- **Texto de un bloque** (`heading` ≤ 300, `paragraph` ≤ 5000 con LF,
  `button` ≤ 100): string → longitud y no vacío (algo distinto de U+0020/LF) →
  caracteres prohibidos → HTML crudo → merge tags.
- **Merge tags, orden**: (1) sobre el valor completo: `{{{`/`}}}` o restos de
  `{{`/`}}` tras quitar candidatos → *malformado*; (2) cada candidato de
  izquierda a derecha: sintaxis → fallback → ruta. Así `{{custom.nope|a|b}}`
  da *fallback inválido*, no *merge tag desconocido*.
- **Merge tags, gramática**: `{{`, espacios U+0020 opcionales (no tab ni LF),
  ruta `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`, espacios U+0020 opcionales, y
  opcionalmente `|` + fallback, `}}`. Cualquier otro relleno (`{{\tcontact.x}}`)
  es *merge tag malformado*. Un fallback vacío (`{{contact.first_name|}}`) es
  válido.
- **Bloques y claves permitidas**: `heading` {type, level, text}, `paragraph`
  {type, text}, `button` {type, text, url}, `image` {type, src, alt, href?,
  width?}, `divider` {type}, `spacer` {type, height}. `type` debe ser string;
  una clave extra es *unknown key*.
- **Re-comprobación bajo bloqueo**: si un campo personalizado se archiva entre
  la validación y el bloqueo, el error usa la misma ubicación que usaría el
  validador (`subject`, `preheader` o `block N`).
- **URL `https:`** (1..2048 code points, esquema en minúsculas):
  `^https://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$`
- **URL `mailto:`** (solo `url` de botón y `href` de imagen): `mailto:` + un
  buzón `^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$` que además normaliza como dirección
  válida de Inc1 (dominio con al menos un punto, etiquetas ≤ 63); sin query.
- **Dominio de remitente**: nombre DNS ASCII en minúsculas con el patrón de
  dominio de Inc1 y **≤ 252 caracteres**: el máximo utilizable, porque una
  identidad necesita al menos `a@` y una dirección tiene como máximo 254
  caracteres (RFC 5321). Un nombre DNS de 253 caracteres (límite RFC 1035)
  nunca podría enviar y se rechaza.

## 7. Contrato del renderer (Increment 3b): escape contextual

**Todo texto es no confiable a efectos de salida**: tanto el texto de la
plantilla ya validado como cada valor sustituido por un merge tag (nombres de
contacto, `organization.name`, campos personalizados, fallbacks). La validación
de la plantilla reduce la superficie, pero **no** sustituye al escape: el texto
validado puede contener legítimamente `&`, `"`, `'` y `>`. El renderer nunca
construye HTML concatenando texto sin escapar.

### 7.1 Orden obligatorio (por campo de texto)

0. **Resolución (servidor, SQL; autoritativa)**: el renderer recibe cada valor
   ya convertido a texto, o `null`. `contact.*` y `organization.name` tal como
   están guardados. Campos personalizados: `valor_jsonb #>> '{}'`, es decir
   - `text` / `select`: el texto guardado, sin cambios (sin recortar);
   - `number`: la forma textual `numeric` de PostgreSQL, sin reformatear
     (`1.50` → `"1.50"`, `1e2` se guarda como `100` → `"100"`, `-2.5` → `"-2.5"`);
   - `boolean`: `"true"` / `"false"`;
   - `date`: `"YYYY-MM-DD"`.
   Sin localización en V1 (las plantillas deben redactarse en consecuencia).
   Comprobado por la suite de 3a sobre valores reales guardados.
1. **Resolver** cada merge tag: valor string, o *ausente* (null, no definido,
   o campo personalizado archivado después de guardar la versión).
2. **Normalizar cada valor** (no el texto de la plantilla, ya validado), en
   este orden exacto:
   1. saltos de línea: CRLF → LF; CR aislado → LF; U+0085 (NEL), U+2028
      (LINE SEPARATOR) y U+2029 (PARAGRAPH SEPARATOR) → LF (son saltos de
      línea, nunca se eliminan: `Hola` + U+2028 + `Mundo` es `Hola Mundo` en
      campos de una línea y un salto en párrafos);
   2. TAB (U+0009) → espacio U+0020;
   3. quitar el resto del conjunto prohibido general de §3 **excepto LF** (LF
      se trata en el paso siguiente, nunca se elimina aquí). Los selectores de
      variación ideográfica **no** forman parte del conjunto general y **nunca**
      se eliminan: en el cuerpo son válidos y en subject/preheader hacen fallar
      el render en el paso 4;
   4. según el campo:
      - **varias líneas** (`paragraph`, y los párrafos de text/plain): LF se
        conserva como salto de línea;
      - **una línea** (subject, preheader, `heading`, texto de `button`): cada
        LF pasa a un espacio U+0020.
   Un valor que tras este paso no contiene nada distinto de U+0020 (ni LF, en
   campos de varias líneas) cuenta como **ausente**. Un valor ausente usa el
   fallback del tag (normalizado igual) si lo tiene; si no, o si el fallback
   también queda vacío, cadena vacía. Nunca error, nunca el literal `{{…}}`.
3. **Sustituir**: insertar los valores normalizados en el texto de la
   plantilla. Un valor nunca se reinterpreta (sin nueva búsqueda de merge
   tags, sin HTML ni Markdown).
4. **Normalizar y validar el campo ensamblado**:
   - subject y preheader: reemplazar cada `=?` por `= ?` (neutraliza marcadores
     RFC 2047 en valores y los formados en la frontera plantilla/valor, p. ej.
     `={{x}}` con valor `?utf-8?…`);
   - campos de una línea: recortar U+0020 en los extremos;
   - campo **vacío** (sin nada distinto de U+0020 y LF) tras este paso:
     - subject vacío → el render **falla** para ese contacto con
       `RENDER_EMPTY_SUBJECT`;
     - preheader vacío → se omite;
     - `heading`, `paragraph` o `button` vacíos → el bloque se omite (nunca un
       enlace invisible);
     - si tras omitir no queda ningún bloque `heading`, `paragraph`, `button`
       o `image` → el render **falla** con `RENDER_EMPTY_BODY`.
   - longitud máxima **después** de sustituir y normalizar (code points):
     subject 400, preheader 500, `heading` 1000, texto de `button` 200,
     `paragraph` 20000. Si un campo la supera, el render **falla** para ese
     contacto con `RENDER_FIELD_TOO_LONG` y la ubicación del campo
     (`subject`, `preheader` o `block N`). Nunca se trunca en silencio.
   - **seguridad del encabezado final** (subject y preheader no vacíos): la
     validación del texto de la plantilla **no basta**, porque un valor
     sustituido puede introducir caracteres propios del encabezado. El valor
     **final renderizado** debe cumplir `private.email_rendered_header_is_safe`
     (autoridad PostgreSQL): ningún carácter del conjunto de encabezado
     (conjunto general, que incluye CR/LF, más U+E0100–U+E01EF) y ningún `=?`.
     Si no se cumple, el render **falla** para ese contacto con
     `RENDER_UNSAFE_HEADER` y la ubicación (`subject` o `preheader`); nunca se
     eliminan ni sustituyen esos caracteres en silencio. El dispatcher
     (Increment 5) vuelve a comprobar esta función antes de enviar.
5. **Escapar** según el contexto de salida (§7.2). Los límites del paso 4 se
   miden antes de escapar.

Fallos: solo `RENDER_EMPTY_SUBJECT`, `RENDER_UNSAFE_HEADER` (con ubicación),
`RENDER_FIELD_TOO_LONG` (con ubicación) y `RENDER_EMPTY_BODY`. Son por contacto
y deterministas; un fallo nunca produce un envío parcial. Todo lo demás se
resuelve por normalización. Orden de evaluación cuando hay varios: campos en
el orden subject → preheader → bloques; en cada campo: vacío → encabezado
inseguro → longitud; `RENDER_EMPTY_BODY` se evalúa al final.

### 7.2 Escape por contexto

| Contexto de salida | Origen | Escape obligatorio |
|---|---|---|
| Texto HTML (`heading`, `paragraph`, `button`) | plantilla + valores | `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, `"`→`&quot;`, `'`→`&#39;`. En `paragraph`, **todo** LF (de la plantilla o de un valor) → `<br>` después de escapar. |
| Atributo HTML (`alt`) | solo plantilla (`alt` no admite merge tags) | Siempre entre comillas dobles; mismo escape que texto HTML. Nunca atributos sin comillas ni atributos de evento. |
| URL (`href`, `src`) | solo plantilla, ya validada (`https:`/`mailto:`) | Dentro de atributo entre comillas dobles con el escape de atributo (`&`→`&amp;`). Los valores **nunca** se insertan en URLs. Sin re-codificar la URL; si no revalida contra §6, el bloque no se renderiza. |
| Subject (encabezado) | plantilla + valores | Ninguno HTML. El proveedor lo codifica (RFC 2047) como texto; nunca se concatena crudo en un encabezado. |
| Preheader (texto oculto al inicio del cuerpo) | plantilla + valores | Escape de texto HTML; nunca es un encabezado. |
| `<title>` del documento, si se usa | subject ya resuelto | Escape de texto HTML. |
| Parte text/plain | plantilla + valores | Ninguno HTML; LF de párrafo como salto de línea; URLs literales. |

### 7.3 Otras reglas y vectores

1. Pie de baja obligatorio inyectado por el sistema; la plantilla no puede
   quitarlo.
2. Vectores obligatorios para 3b:
   `supabase/tests/fixtures/email_render_v1_cases.json`. Cada plantilla de
   esos vectores es `email-content.v1` válida (lo comprueba la suite de 3a).
   Cubren: escape de texto de plantilla con `&`, `"` y `'` en cada contexto;
   `alt` con `x" onerror="alert(1)`; valores con `<script>`; valores que
   parecen merge tags; LF de plantilla y de valores en párrafos; LF, CR y
   caracteres prohibidos de valores en campos de una línea; `=?` en valores y
   en la frontera plantilla/valor; fallback y campo archivado; subject vacío,
   cuerpo vacío y bloques omitidos; valores `number`, `boolean` y `date`
   resueltos; valor en blanco y valor vacío tras normalizar (usan el fallback);
   fallback vacío; TAB y CR aislado; campos demasiado largos tras sustituir.

## 8. Requisito para el proveedor (Increment 4)

El `from_name` rechaza `< > " \ @`, las *encoded words* RFC 2047 (`=?`) y el
conjunto prohibido, pero admite `, ; : ( )`. El adaptador debe citar/codificar
el display name según RFC 5322/2047 (p. ej. `"Acme, Inc" <hola@acme.com>`);
nunca concatenarlo crudo. El subject se codifica siempre como texto (RFC 2047),
de modo que una secuencia `=?…?=` escrita por el usuario se muestre literal.

## 9. Ensamblado del documento (Increment 3b, aditivo)

Sección aditiva: no cambia nada de §1–§8. Los cuatro fallos por contacto de
§7.1 (`RENDER_EMPTY_SUBJECT`, `RENDER_UNSAFE_HEADER`, `RENDER_FIELD_TOO_LONG`,
`RENDER_EMPTY_BODY`) siguen siendo los únicos resultados de fallo de
`renderTemplate`. Implementación: `supabase/functions/_shared/email/render_v1.ts`.
Vectores: `supabase/tests/fixtures/email_render_v1_document_cases.json`
(salidas esperadas escritas a mano).

### 9.1 Resultado de `renderTemplate`

Éxito: `{ ok: true, subject, preheader, preheader_html, blocks }`. `subject` y
`preheader` son texto plano final (§7.1 paso 4; `preheader` es `null` si se
omite). Cada bloque conserva su texto plano **y** su forma escapada, con la
invariante `html = escape(text)` (en `paragraph`, cada LF → `<br>` tras
escapar) y `*_attr = escape(valor)`:

| Bloque | Campos |
|---|---|
| `heading` | `type`, `level`, `text`, `html` |
| `paragraph` | `type`, `text`, `html` |
| `button` | `type`, `text`, `url`, `html`, `href_attr` |
| `image` | `type`, `src`, `alt`, `href` (o `null`), `width` (o `null`), `src_attr`, `alt_attr`, `href_attr` (solo si hay `href`) |
| `divider` | `type` |
| `spacer` | `type`, `height` |

Fallo: `{ ok: false, error }` más `location` en `RENDER_UNSAFE_HEADER` y
`RENDER_FIELD_TOO_LONG`; nunca contiene salida parcial.

### 9.2 Documento HTML (bytes exactos, saltos LF, termina en LF)

```
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{subject}</title>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">{preheader}</div>
{un bloque por línea}
<div data-orvesen-footer="email-footer.v1">
<hr>
<p>{organization_name}</p>
<p>{notice}</p>
<p><a href="{unsubscribe_url}">{unsubscribe_label}</a></p>
</div>
</body>
</html>
```

- `{subject}`: subject final con escape de texto HTML (§7.2). Nunca se
  reutiliza la forma de encabezado sin escapar.
- La línea del preheader oculto solo existe si hay preheader; si no, se omite
  la línea entera. La línea de `notice` solo existe si `notice` no es `null`.
- Bloques: `heading` → `<hN>{html}</hN>`; `paragraph` → `<p>{html}</p>`;
  `button` → `<p><a href="{href_attr}">{html}</a></p>`; `image` →
  `<img src="{src_attr}" alt="{alt_attr}">` (con ` width="{width}"` antes de
  `>` si existe), envuelto en `<a href="{href_attr}">…</a>` si hay `href`;
  `divider` → `<hr>`; `spacer` → `<div style="height:{height}px"></div>`.
- El pie del sistema va **siempre** después del último bloque, fuera del
  contenido de la plantilla; la plantilla no puede quitarlo, moverlo ni
  sustituirlo (no existe ningún bloque que lo haga).
- `assembleDocument` **no confía** en `html`/`*_attr` recibidos: vuelve a
  escapar desde los campos de texto plano con las mismas funciones de §7.2, y
  revalida subject/preheader con `isRenderedHeaderSafe` y las URLs con §6.

### 9.3 Parte text/plain (saltos LF, termina en LF)

- Bloques en orden, separados por una línea vacía: `heading` → texto;
  `paragraph` → texto (LF conservados); `button` → texto, LF, URL literal;
  `image` → `[alt]` si `alt` contiene algo distinto de U+0020, y/o el `href`
  literal en la línea siguiente (sin ninguno de los dos no aporta nada);
  `divider` → `---`; `spacer` → nada. El preheader no forma parte del texto.
- Pie: tras el cuerpo, una línea vacía y después `-- ` (con espacio final),
  `organization_name`, `notice` (si existe, LF conservados) y
  `{unsubscribe_label}: {unsubscribe_url}`.
- Sin escape HTML. Mismo texto plano que la parte HTML (paridad comprobada
  por los vectores).

### 9.4 Pie del sistema (`email-footer.v1`) y errores de ensamblado

Lo proporciona el sistema (Increment 5/6), nunca la plantilla:

```json
{ "version": "email-footer.v1", "organization_name": "...", "unsubscribe_label": "...",
  "unsubscribe_url": "https://...", "notice": "..." | null }
```

Validación, en este orden: objeto → claves (solo esas cinco; `notice` puede
faltar = `null`) → `version` → `organization_name` (1..200 code points, algo
distinto de U+0020, sin caracteres prohibidos de §3 ni LF) →
`unsubscribe_label` (1..100, mismas reglas) → `unsubscribe_url` (URL `https:`
de §6; `mailto:` no se admite) → `notice` (`null` o 1..1000, algo distinto de
U+0020 y LF, sin caracteres prohibidos de §3 salvo LF). El pie no admite merge
tags: `{{…}}` se muestra literal (escapado).

Errores de `assembleDocument` (resultado `{ ok: false, ... }`; espacio de
nombres propio, **no** son fallos por contacto de §7):

| Código | Cuándo |
|---|---|
| `DOCUMENT_RENDER_INVALID` (`reason`) | `rendered` no es un resultado de éxito de `renderTemplate` bien formado (incluido un resultado de fallo). Se evalúa primero. |
| `DOCUMENT_FOOTER_REQUIRED` | falta el pie (`null`/ausente). |
| `DOCUMENT_FOOTER_INVALID` (`field`, `reason`) | primera regla del pie que no se cumple. |

`renderTemplate` con una entrada estructuralmente imposible para una versión
guardada (no es objeto, tipo de bloque desconocido, campos ausentes) lanza la
excepción `RENDER_INPUT_INVALID`: es un error del llamador, nunca un
resultado por contacto, y no revalida el contenido guardado (§1).

### 9.5 Endurecimiento de entrada solo TS

PostgreSQL no puede producir U+0000 ni surrogates UTF-16 sin pareja. Si un
valor sustituido los contiene, se eliminan en §7.1 paso 2.3 (junto al
conjunto prohibido); un valor que no es string cuenta como ausente; el pie los
rechaza como caracteres prohibidos; `isRenderedHeaderSafe` devuelve `false`
para ellos y para cualquier no-string (fuera del dominio de la función SQL, se
falla cerrado). Para toda cadena representable en PostgreSQL,
`isRenderedHeaderSafe` coincide exactamente con
`private.email_rendered_header_is_safe` (prueba diferencial contra la función
SQL real).
