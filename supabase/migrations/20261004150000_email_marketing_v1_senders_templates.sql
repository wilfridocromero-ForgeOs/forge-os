-- ORVESEN Email Marketing V1 - Increment 3a: Senders, templates and
-- server-side email-content.v1 validation.
--
-- Scope: sender domains (registered, never verified here: no DNS), sender
-- identities, templates with immutable (append-only) versions, and the
-- email-content.v1 validator. No renderer, no campaigns, no provider, no
-- sending, no UI.
--
-- Builds on Increments 1 and 2. Changes to earlier objects, both additive:
-- * private.email_can gains exactly three actions (manage_senders,
--   manage_content, manage_campaigns). Roles, tenant derivation and every
--   existing action are unchanged. This deliberately changes the Increment 1
--   function fingerprint (documented in docs/email-marketing/ARCHITECTURE.md).
-- * email_audit_log.entity_type accepts the new entity types.
--
-- Security model (unchanged):
-- * Organization and actor are derived server-side; RPCs never accept them.
-- * API roles get SELECT only (RLS), never direct DML. Rows are never deleted.
-- * Template versions are immutable for every role. Content is structured
--   (email-content.v1 blocks): raw HTML is rejected, URLs are https:/mailto:
--   only, merge tags come from an allowlist and are never allowed in URLs.
-- * A sender domain can only be 'unverified' in this increment; verification
--   states are reserved for a later increment and unreachable here.

-- ---------------------------------------------------------------------------
-- Authorization: additive extension of the single decision point.
-- Identical to Increment 1 except for the three new actions.
-- ---------------------------------------------------------------------------

create or replace function private.email_can(requested_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    requested_action in (
      'read',
      'manage_contacts',
      'manage_consent',
      'manage_suppressions',
      'lift_suppression',
      'manage_senders',
      'manage_content',
      'manage_campaigns'
    )
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.organization_memberships as membership
      where membership.user_id = (select auth.uid())
        and membership.organization_id = public.current_user_organization_id()
        and membership.role in ('founder', 'admin')
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Audit: accept the new entity types (additive).
-- ---------------------------------------------------------------------------

alter table public.email_audit_log
  drop constraint email_audit_log_entity_type_check,
  add constraint email_audit_log_entity_type_check check (entity_type in (
    'contact', 'consent', 'suppression',
    'list', 'tag', 'custom_field', 'segment', 'crm_import',
    'sender_domain', 'sender_identity', 'template', 'template_version'
  ));

-- ---------------------------------------------------------------------------
-- Pure helpers (used by CHECK constraints, triggers and RPCs)
-- ---------------------------------------------------------------------------

-- Canonical sender domain: lower-case, trimmed, plain ASCII (punycode) DNS
-- name (labels <= 63) of at most 252 characters. 252 is the usable maximum:
-- an identity needs at least a 1-character local part and '@', and an address
-- is at most 254 characters (RFC 5321), so a 253-character DNS name (the
-- RFC 1035 limit) could never send. The label pattern is the domain pattern
-- of private.email_normalize_address (Increment 1), kept identical on purpose.
-- Returns null for anything else.
create or replace function private.email_normalize_domain(raw_domain text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  candidate text := lower(btrim(raw_domain, E' \t\r\n'));
begin
  if candidate is null or candidate = '' or char_length(candidate) > 252
     or candidate !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' then
    return null;
  end if;
  return candidate;
end;
$$;

-- True when text contains characters that are unsafe in headers or single
-- lines, or invisible characters usable for spoofing:
--   U+0001-U+001F  C0 controls (LF optionally allowed)
--   U+007F-U+009F  DEL and C1 controls (incl. NEL U+0085)
--   U+00AD         SOFT HYPHEN
--   U+034F         COMBINING GRAPHEME JOINER
--   U+061C         ARABIC LETTER MARK (bidi control)
--   U+115F-U+1160  HANGUL CHOSEONG/JUNGSEONG FILLER
--   U+17B4-U+17B5  KHMER INHERENT VOWELS (invisible)
--   U+180B-U+180F  MONGOLIAN FREE VARIATION SELECTORS and VOWEL SEPARATOR
--   U+200B         ZERO WIDTH SPACE
--   U+200E-U+200F  LEFT-TO-RIGHT / RIGHT-TO-LEFT MARK (bidi controls)
--   U+2028-U+202E  line/paragraph separators, bidi embeddings and overrides
--   U+2060-U+206F  word joiner, invisible operators, bidi isolates, deprecated format controls
--   U+2800         BRAILLE PATTERN BLANK (renders blank)
--   U+3164         HANGUL FILLER
--   U+FEFF         BOM / ZERO WIDTH NO-BREAK SPACE
--   U+FFA0         HALFWIDTH HANGUL FILLER
--   U+FFF0-U+FFFB  reserved specials and interlinear annotation controls
--   U+1BCA0-U+1BCA3 shorthand format controls (invisible)
--   U+1D173-U+1D17A musical symbol format controls (invisible)
--   U+E0000-U+E00FF tag characters and reserved default-ignorables (invisible
--                  payloads; also rejects subdivision flag emoji, an accepted
--                  V1 limitation)
--   U+E01F0-U+E0FFF reserved default-ignorables (invisible)
-- Allowed in every field (headers included): ZWJ/ZWNJ (U+200C/U+200D, emoji
-- sequences) and variation selectors U+FE00-U+FE0F (emoji presentation).
-- Allowed only in body text: U+E0100-U+E01EF (ideographic variation sequences
-- for legitimate CJK glyph variants). These ARE invisible and CAN carry a
-- hidden payload; header fields reject them (email_text_has_header_unsafe_chars,
-- also for the final rendered value: email_rendered_header_is_safe) and the
-- contract records the residual risk for body text.
-- The set is explicit (no POSIX character class) so the result never depends
-- on the database locale; docs/email-marketing/EMAIL_CONTENT_V1_CONTRACT.md is
-- the normative list for the TS implementation.
create or replace function private.email_text_has_unsafe_chars(value text, allow_newline boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when value is null then false else
    (case when allow_newline then replace(value, chr(10), '') else value end)
      ~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || chr(173) || chr(847) || chr(1564)
         || chr(4447) || '-' || chr(4448) || chr(6068) || '-' || chr(6069) || chr(6155) || '-' || chr(6159) || chr(8203)
         || chr(8206) || '-' || chr(8207) || chr(8232) || '-' || chr(8238) || chr(8288) || '-' || chr(8303)
         || chr(10240) || chr(12644) || chr(65279) || chr(65440) || chr(65520) || '-' || chr(65531)
         || chr(113824) || '-' || chr(113827) || chr(119155) || '-' || chr(119162)
         || chr(917504) || '-' || chr(917759) || chr(918000) || '-' || chr(921599) || ']')
  end;
$$;

-- Security-sensitive header fields (from_name, subject, preheader): the
-- general set plus ideographic variation selectors U+E0100-U+E01EF, which are
-- invisible and can carry a hidden payload. V1 rule is fail-closed (no
-- contextual exception); body text keeps them for legitimate CJK variants.
create or replace function private.email_text_has_header_unsafe_chars(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.email_text_has_unsafe_chars(value, false)
    or coalesce(value ~ ('[' || chr(917760) || '-' || chr(917999) || ']'), false);
$$;

-- Authority for a FINAL rendered subject or preheader, i.e. after merge
-- substitution and renderer normalization (contract section 7.1 step 4):
-- template-source validation alone is not enough, because a merge value can
-- introduce header-only characters. The final value must contain no character
-- of the header set (general set, which includes CR/LF, plus U+E0100-U+E01EF)
-- and no RFC 2047 encoded-word marker. The renderer never removes header-only
-- characters: when this is false it fails closed with RENDER_UNSAFE_HEADER.
create or replace function private.email_rendered_header_is_safe(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(value is not null
    and not private.email_text_has_header_unsafe_chars(value)
    and strpos(value, '=?') = 0, false);
$$;

-- Tag-like sequences ("<p", "</", "<!--", "<?", "< script") are rejected so
-- template text can never carry raw HTML. A bare "<" (e.g. "5 < 6") is
-- allowed. The check also runs on the text with every merge-tag candidate
-- replaced by a letter, so markup cannot be assembled around a merge tag
-- ("<{{contact.first_name|script}}>"). Substituted merge VALUES are untrusted
-- and are never validated here: the renderer must escape them (contract).
create or replace function private.email_text_has_raw_html(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    value ~ '<[ \n]*[A-Za-z!/?]'
    or regexp_replace(value, '\{\{[^{}]*\}\}', 'x', 'g') ~ '<[ \n]*[A-Za-z!/?]',
    false);
$$;

-- Display name for the From header: 1..100 chars, trimmed, header-safe, and
-- without characters that allow address spoofing inside the display name,
-- including RFC 2047 encoded words ("=?charset?B?...?=") that could carry
-- those characters in encoded form.
create or replace function private.email_from_name_is_valid(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    char_length(value) between 1 and 100
    and value = btrim(value)
    and not private.email_text_has_header_unsafe_chars(value)
    and value !~ '[<>"\\@]'
    and strpos(value, '=?') = 0,
    false);
$$;

-- Single authority for subject/preheader rules (subject 1..200, preheader
-- 1..250): returns the first violated rule, in the validator's order, or null.
-- Used by email_content_validate (for the error detail) and, through
-- email_header_text_is_valid, by the column CHECK constraints, so every role
-- gets exactly the same rules.
create or replace function private.email_header_text_problem(value text, max_length integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when value is null or char_length(value) not between 1 and max_length or value <> btrim(value)
      then 'must be 1..' || max_length || ' characters'
    when private.email_text_has_header_unsafe_chars(value) then 'control or unsafe characters'
    when private.email_text_has_raw_html(value) then 'raw HTML is not allowed'
    -- RFC 2047 encoded words ("=?charset?B?...?=") would let a mail client
    -- decode characters this validator forbids; the renderer neutralizes the
    -- marker in substituted values and across template/value boundaries.
    when strpos(value, '=?') > 0 then 'encoded words are not allowed'
  end;
$$;

create or replace function private.email_header_text_is_valid(value text, max_length integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.email_header_text_problem(value, max_length) is null;
$$;

-- https:// with an ASCII host (no userinfo, no IP literal) and a conservative
-- character set; optionally mailto: with a single plain address and no query.
create or replace function private.email_url_is_allowed(url text, allow_mailto boolean)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  mailbox text;
begin
  if url is null or char_length(url) not between 1 and 2048 then
    return false;
  end if;
  if url like 'https://%' then
    return url ~ '^https://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][A-Za-z0-9._~:/?#@!$&()*+,;=%-]*)?$';
  end if;
  if allow_mailto and url like 'mailto:%' then
    mailbox := substr(url, 8);
    return mailbox ~ '^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+$'
      and private.email_normalize_address(mailbox) is not null;
  end if;
  return false;
end;
$$;

-- Canonical content hash of a template version (subject + preheader + content).
-- jsonb text output is canonical, so equal content always hashes equally.
create or replace function private.email_template_content_hash(subject text, preheader text, content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(
    jsonb_build_object('subject', subject, 'preheader', preheader, 'content', content)::text, 'UTF8')), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A domain the organization intends to send from. Registration only: nothing
-- is verified in this increment, so verification_status is always 'unverified'.
create table public.email_sender_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  domain text not null check (char_length(domain) between 3 and 252 and domain = private.email_normalize_domain(domain)),
  verification_status text not null default 'unverified' check (verification_status in ('unverified')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  unique (organization_id, id),
  check ((status = 'active') = (archived_at is null))
);

create unique index email_sender_domains_active_domain_key
  on public.email_sender_domains (organization_id, domain) where status = 'active';

create table public.email_sender_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  domain_id uuid not null,
  local_part text not null check (
    char_length(local_part) between 1 and 64
    and local_part ~ '^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?$'
    and local_part not like '%..%'
  ),
  address text not null check (
    address = private.email_normalize_address(address) and split_part(address, '@', 1) = local_part
  ),
  from_name text not null check (private.email_from_name_is_valid(from_name)),
  reply_to text check (reply_to is null or reply_to = private.email_normalize_address(reply_to)),
  status text not null default 'active' check (status in ('active', 'archived')),
  version bigint not null default 1 check (version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  unique (organization_id, id),
  foreign key (organization_id, domain_id)
    references public.email_sender_domains (organization_id, id) on delete restrict,
  check ((status = 'active') = (archived_at is null)),
  check (updated_at >= created_at)
);

create unique index email_sender_identities_active_address_key
  on public.email_sender_identities (organization_id, address) where status = 'active';
create index email_sender_identities_domain_idx
  on public.email_sender_identities (organization_id, domain_id);

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 100 and name = btrim(name)
    and not private.email_text_has_unsafe_chars(name, false)),
  -- lower() follows the database locale/collation (same pattern as the
  -- Increment 2 lists, tags and segments): which non-ASCII names count as
  -- duplicates can differ between databases. V1 accepts this; a locale-free
  -- normalization is a cross-domain decision for every Email name.
  name_normalized text generated always as (lower(name)) stored,
  description text check (description is null or (char_length(description) between 1 and 500
    and not private.email_text_has_unsafe_chars(description, false))),
  status text not null default 'active' check (status in ('active', 'archived')),
  latest_version integer not null default 0 check (latest_version >= 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  unique (organization_id, id),
  check ((status = 'active') = (archived_at is null)),
  check (updated_at >= created_at)
);

create unique index email_templates_active_name_key
  on public.email_templates (organization_id, name_normalized) where status = 'active';

-- Append-only. content_sha256 and the bounded merge-tag evidence
-- (merge_tag_count, merge_tags_sha256) are always computed server-side.
create table public.email_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  template_id uuid not null,
  version_number integer not null check (version_number > 0),
  subject text not null check (private.email_header_text_is_valid(subject, 200)),
  preheader text check (preheader is null or private.email_header_text_is_valid(preheader, 250)),
  content jsonb not null check (
    jsonb_typeof(content) = 'object'
    and content ->> 'version' = 'email-content.v1'
    and octet_length(content::text) <= 65536
  ),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  merge_tag_count integer not null check (merge_tag_count >= 0),
  merge_tags_sha256 text not null check (merge_tags_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, template_id, version_number),
  foreign key (organization_id, template_id)
    references public.email_templates (organization_id, id) on delete restrict
);

-- ---------------------------------------------------------------------------
-- email-content.v1 validation
--
-- { "version": "email-content.v1", "blocks": [ block, ... ] }   1..100 blocks, <= 65536 bytes
--   { "type": "heading",   "level": 1..3, "text": text(1..300, single line) }
--   { "type": "paragraph", "text": text(1..5000, LF allowed) }
--   { "type": "button",    "text": text(1..100, single line), "url": https:|mailto: }
--   { "type": "image",     "src": https:, "alt": plain(0..300), "href"?: https:|mailto:, "width"?: 1..600 }
--   { "type": "divider" }
--   { "type": "spacer",    "height": 4..96 }
-- Text is plain text (never interpreted as HTML; tag-like sequences rejected).
-- Merge tags {{ path }} or {{ path | fallback }} are allowed in subject,
-- preheader and block text only, never in URLs or alt. Paths:
--   contact.first_name, contact.last_name, contact.email, organization.name,
--   custom.<key> (an active custom field of the organization).
-- Tokenization: candidates match \{\{[^{}]*\}\}; after removing them no "{{"
-- or "}}" may remain, and "{{{" / "}}}" are rejected (no raw-output syntax).
-- Errors: 22023 EMAIL_INVALID_CONTENT, detail "<location>: <reason>".
-- ---------------------------------------------------------------------------

create or replace function private.email_content_invalid(location text, reason text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception using errcode = '22023', message = 'EMAIL_INVALID_CONTENT',
    detail = location || ': ' || reason;
end;
$$;

-- Validates the merge tags of one text value and returns their paths.
create or replace function private.email_merge_tag_paths(
  target_organization_id uuid,
  location text,
  value text
)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  candidate text[];
  parts text[];
  tag_path text;
  fallback text;
  paths text[] := array[]::text[];
begin
  if value is null then
    return paths;
  end if;
  if value ~ '\{\{\{|\}\}\}'
     or regexp_replace(value, '\{\{[^{}]*\}\}', '', 'g') ~ '\{\{|\}\}' then
    perform private.email_content_invalid(location, 'malformed merge tag');
  end if;
  for candidate in select regexp_matches(value, '\{\{([^{}]*)\}\}', 'g') loop
    parts := regexp_match(candidate[1], '^ *([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*) *(\|(.*))?$');
    if parts is null then
      perform private.email_content_invalid(location, 'malformed merge tag');
    end if;
    tag_path := parts[1];
    fallback := parts[3];
    if fallback is not null then
      fallback := btrim(fallback, ' ');
      if char_length(fallback) > 100 or fallback ~ '[|<>]' or private.email_text_has_unsafe_chars(fallback, false) then
        perform private.email_content_invalid(location, 'invalid merge tag fallback');
      end if;
    end if;
    if tag_path in ('contact.first_name', 'contact.last_name', 'contact.email', 'organization.name') then
      null;
    elsif tag_path ~ '^custom\.[a-z][a-z0-9_]{0,39}$' and exists (
      select 1 from public.email_custom_field_definitions as field
      where field.organization_id = target_organization_id
        and field.key = substr(tag_path, 8)
        and field.status = 'active'
    ) then
      null;
    else
      perform private.email_content_invalid(location, 'unknown merge tag: ' || tag_path);
    end if;
    paths := array_append(paths, tag_path);
  end loop;
  return paths;
end;
$$;

-- Validates one block text value (string, non-blank, bounded, safe, no raw
-- HTML, valid merge tags) and returns its merge tag paths.
create or replace function private.email_content_text(
  target_organization_id uuid,
  location text,
  value jsonb,
  max_length integer,
  allow_newline boolean
)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  text_value text;
begin
  if value is null or jsonb_typeof(value) <> 'string' then
    perform private.email_content_invalid(location, 'text must be a string');
  end if;
  text_value := value #>> '{}';
  if char_length(text_value) > max_length or btrim(text_value, E' \n') = '' then
    perform private.email_content_invalid(location, format('text must be 1..%s characters', max_length));
  end if;
  if private.email_text_has_unsafe_chars(text_value, allow_newline) then
    perform private.email_content_invalid(location, 'control or unsafe characters');
  end if;
  if private.email_text_has_raw_html(text_value) then
    perform private.email_content_invalid(location, 'raw HTML is not allowed');
  end if;
  return private.email_merge_tag_paths(target_organization_id, location, text_value);
end;
$$;

create or replace function private.email_json_int_between(value jsonb, lower_bound integer, upper_bound integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_typeof(value) = 'number'
    and (value #>> '{}') ~ '^[0-9]{1,4}$'
    and (value #>> '{}')::integer between lower_bound and upper_bound,
    false);
$$;

-- Validates subject, preheader and content. Returns the distinct merge tag
-- paths used (sorted) or raises EMAIL_INVALID_CONTENT.
create or replace function private.email_content_validate(
  target_organization_id uuid,
  subject text,
  preheader text,
  content jsonb
)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  block jsonb;
  block_index integer := 0;
  block_type text;
  allowed_keys text[];
  location text;
  alt_text text;
  header_problem text;
  paths text[] := array[]::text[];
begin
  -- Subject and preheader rules have one authority, shared with the CHECKs.
  header_problem := private.email_header_text_problem(subject, 200);
  if header_problem is not null then
    perform private.email_content_invalid('subject', header_problem);
  end if;
  paths := paths || private.email_merge_tag_paths(target_organization_id, 'subject', subject);

  if preheader is not null then
    header_problem := private.email_header_text_problem(preheader, 250);
    if header_problem is not null then
      perform private.email_content_invalid('preheader', header_problem);
    end if;
    paths := paths || private.email_merge_tag_paths(target_organization_id, 'preheader', preheader);
  end if;

  if content is null or jsonb_typeof(content) <> 'object' then
    perform private.email_content_invalid('content', 'must be an object');
  end if;
  if octet_length(content::text) > 65536 then
    perform private.email_content_invalid('content', 'exceeds 65536 bytes');
  end if;
  if exists (select 1 from jsonb_object_keys(content) as k where k not in ('version', 'blocks')) then
    perform private.email_content_invalid('content', 'unknown top-level key');
  end if;
  if content ->> 'version' is distinct from 'email-content.v1' then
    perform private.email_content_invalid('content', 'version must be email-content.v1');
  end if;
  if jsonb_typeof(content -> 'blocks') is distinct from 'array' then
    perform private.email_content_invalid('content', 'blocks must be an array of 1..100 blocks');
  end if;
  if jsonb_array_length(content -> 'blocks') not between 1 and 100 then
    perform private.email_content_invalid('content', 'blocks must be an array of 1..100 blocks');
  end if;

  for block in select value from jsonb_array_elements(content -> 'blocks') loop
    block_index := block_index + 1;
    location := 'block ' || block_index;
    if jsonb_typeof(block) <> 'object' then
      perform private.email_content_invalid(location, 'block must be an object');
    end if;
    block_type := case when jsonb_typeof(block -> 'type') = 'string' then block ->> 'type' end;
    allowed_keys := case block_type
      when 'heading' then array['type', 'level', 'text']
      when 'paragraph' then array['type', 'text']
      when 'button' then array['type', 'text', 'url']
      when 'image' then array['type', 'src', 'alt', 'href', 'width']
      when 'divider' then array['type']
      when 'spacer' then array['type', 'height']
      else null end;
    if allowed_keys is null then
      perform private.email_content_invalid(location, 'unknown block type');
    end if;
    if exists (select 1 from jsonb_object_keys(block) as k where k <> all (allowed_keys)) then
      perform private.email_content_invalid(location, 'unknown key');
    end if;

    if block_type = 'heading' then
      if not private.email_json_int_between(block -> 'level', 1, 3) then
        perform private.email_content_invalid(location, 'level must be an integer 1..3');
      end if;
      paths := paths || private.email_content_text(target_organization_id, location, block -> 'text', 300, false);

    elsif block_type = 'paragraph' then
      paths := paths || private.email_content_text(target_organization_id, location, block -> 'text', 5000, true);

    elsif block_type = 'button' then
      paths := paths || private.email_content_text(target_organization_id, location, block -> 'text', 100, false);
      if jsonb_typeof(block -> 'url') is distinct from 'string'
         or not private.email_url_is_allowed(block ->> 'url', true) then
        perform private.email_content_invalid(location, 'url must be https:// or mailto:');
      end if;

    elsif block_type = 'image' then
      if jsonb_typeof(block -> 'src') is distinct from 'string'
         or not private.email_url_is_allowed(block ->> 'src', false) then
        perform private.email_content_invalid(location, 'src must be https://');
      end if;
      if not block ? 'alt' then
        perform private.email_content_invalid(location, 'alt is required');
      end if;
      if jsonb_typeof(block -> 'alt') <> 'string' or char_length(block ->> 'alt') > 300 then
        perform private.email_content_invalid(location, 'alt must be a string of 0..300 characters');
      end if;
      alt_text := block ->> 'alt';
      if private.email_text_has_unsafe_chars(alt_text, false) then
        perform private.email_content_invalid(location, 'control or unsafe characters');
      end if;
      if private.email_text_has_raw_html(alt_text) then
        perform private.email_content_invalid(location, 'raw HTML is not allowed');
      end if;
      if alt_text ~ '\{\{|\}\}' then
        perform private.email_content_invalid(location, 'merge tags are not allowed in alt');
      end if;
      if block ? 'href' and (jsonb_typeof(block -> 'href') <> 'string'
                             or not private.email_url_is_allowed(block ->> 'href', true)) then
        perform private.email_content_invalid(location, 'href must be https:// or mailto:');
      end if;
      if block ? 'width' and not private.email_json_int_between(block -> 'width', 1, 600) then
        perform private.email_content_invalid(location, 'width must be an integer 1..600');
      end if;

    elsif block_type = 'spacer' then
      if not private.email_json_int_between(block -> 'height', 4, 96) then
        perform private.email_content_invalid(location, 'height must be an integer 4..96');
      end if;
    end if;
  end loop;

  -- Bytewise (C collation) order: locale-independent and equal to the default
  -- JS sort for these ASCII paths.
  return (select coalesce(array_agg(tag_path order by tag_path collate "C"), array[]::text[])
          from (select distinct p as tag_path from unnest(paths) as p) as distinct_paths);
end;
$$;

-- ---------------------------------------------------------------------------
-- Invariant triggers (apply to every role, including the owner)
-- ---------------------------------------------------------------------------

-- Lifecycle (created active, archived terminal, no delete, identity immutable)
-- reuses the Increment 2 catalog guard.
create trigger email_sender_domains_guard
before insert or update or delete on public.email_sender_domains
for each row execute function private.email_catalog_guard('domain', 'verification_status');
create trigger email_sender_identities_guard
before insert or update or delete on public.email_sender_identities
for each row execute function private.email_catalog_guard('domain_id', 'local_part', 'address');
create trigger email_templates_guard
before insert or update or delete on public.email_templates
for each row execute function private.email_catalog_guard('name', 'description');

create trigger email_sender_domains_no_truncate before truncate on public.email_sender_domains
for each statement execute function private.email_reject_mutation('EMAIL_CATALOG_DELETE_FORBIDDEN');
create trigger email_sender_identities_no_truncate before truncate on public.email_sender_identities
for each statement execute function private.email_reject_mutation('EMAIL_CATALOG_DELETE_FORBIDDEN');
create trigger email_templates_no_truncate before truncate on public.email_templates
for each statement execute function private.email_reject_mutation('EMAIL_CATALOG_DELETE_FORBIDDEN');

create trigger email_template_versions_immutable
before update or delete on public.email_template_versions
for each row execute function private.email_reject_mutation('EMAIL_TEMPLATE_VERSION_IMMUTABLE');
create trigger email_template_versions_no_truncate
before truncate on public.email_template_versions
for each statement execute function private.email_reject_mutation('EMAIL_TEMPLATE_VERSION_IMMUTABLE');

-- A domain with active identities cannot be archived.
create or replace function private.email_sender_domains_archive_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status = 'archived' and exists (
    select 1 from public.email_sender_identities as identity
    where identity.organization_id = old.organization_id
      and identity.domain_id = old.id
      and identity.status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'EMAIL_SENDER_DOMAIN_IN_USE';
  end if;
  return new;
end;
$$;

create trigger email_sender_domains_archive_guard
before update on public.email_sender_domains
for each row execute function private.email_sender_domains_archive_guard();

-- New identities need an active domain of the same organization (locked so a
-- concurrent archive serializes) and an address that matches that domain.
create or replace function private.email_sender_identities_domain_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  domain_row public.email_sender_domains%rowtype;
begin
  if new.version <> 1 then
    raise exception using errcode = '55000', message = 'EMAIL_CATALOG_INVALID_INITIAL_STATE';
  end if;
  select * into domain_row
  from public.email_sender_domains as sender_domain
  where sender_domain.organization_id = new.organization_id and sender_domain.id = new.domain_id
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_SENDER_DOMAIN_NOT_FOUND';
  end if;
  if domain_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_SENDER_DOMAIN_ARCHIVED';
  end if;
  if new.address is distinct from new.local_part || '@' || domain_row.domain then
    raise exception using errcode = '55000', message = 'EMAIL_SENDER_ADDRESS_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger email_sender_identities_domain_guard
before insert on public.email_sender_identities
for each row execute function private.email_sender_identities_domain_guard();

-- Identities: a change to from_name or reply_to bumps version exactly once;
-- version cannot be set directly.
create or replace function private.email_sender_identities_versioning()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.from_name is distinct from old.from_name or new.reply_to is distinct from old.reply_to then
    new.version := old.version + 1;
    new.updated_at := now();
  else
    new.version := old.version;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger email_sender_identities_versioning
before update on public.email_sender_identities
for each row execute function private.email_sender_identities_versioning();

-- Templates: latest_version starts at 0 and can only advance by one, to a
-- version row that exists.
create or replace function private.email_templates_latest_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.latest_version <> 0 then
      raise exception using errcode = '55000', message = 'EMAIL_CATALOG_INVALID_INITIAL_STATE';
    end if;
    return new;
  end if;
  if new.latest_version is distinct from old.latest_version then
    if new.latest_version <> old.latest_version + 1 or not exists (
      select 1 from public.email_template_versions as template_version
      where template_version.organization_id = old.organization_id
        and template_version.template_id = old.id
        and template_version.version_number = new.latest_version
    ) then
      raise exception using errcode = '55000', message = 'EMAIL_TEMPLATE_VERSION_POINTER_INVALID';
    end if;
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create trigger email_templates_latest_guard
before insert or update on public.email_templates
for each row execute function private.email_templates_latest_guard();

-- Versions: the template must be active and locked, the number must be the
-- next one, the author must be the session actor, the content must validate,
-- and the hash and merge-tag evidence are always recomputed.
-- This guard is the authoritative content-validation boundary for every
-- insert path.
-- Referenced custom fields are share-locked and re-checked, text by text in
-- the validator's order, so a concurrent email_archive_custom_field (which
-- takes FOR UPDATE) either commits first and makes this insert fail with the
-- same location the validator would report, or waits until this version is
-- committed.
-- Actor: when a session actor exists (auth.uid()), created_by must equal it,
-- so the audit actor and the stored author can never disagree. Without a
-- session actor (owner/maintenance path) the audit records actor 'system' and
-- keeps created_by as evidence.
-- No audit here: a BEFORE ROW trigger also fires for rows that ON CONFLICT DO
-- NOTHING then skips. Version creation is audited in the AFTER INSERT trigger.
create or replace function private.email_template_versions_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  template_row public.email_templates%rowtype;
  merge_tags text[];
  tag_order bigint;
  tag_location text;
  tag_text text;
  tag_path text;
begin
  select * into template_row
  from public.email_templates as template
  where template.organization_id = new.organization_id and template.id = new.template_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_TEMPLATE_NOT_FOUND';
  end if;
  if template_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_TEMPLATE_ARCHIVED';
  end if;
  if new.version_number is distinct from template_row.latest_version + 1 then
    raise exception using errcode = '40001', message = 'EMAIL_TEMPLATE_VERSION_CONFLICT';
  end if;
  if (select auth.uid()) is not null and new.created_by is distinct from (select auth.uid()) then
    raise exception using errcode = '42501', message = 'EMAIL_ACTOR_MISMATCH';
  end if;
  merge_tags := private.email_content_validate(new.organization_id, new.subject, new.preheader, new.content);
  for tag_order, tag_location, tag_text in
    select 1, 'subject', new.subject
    union all
    select 2, 'preheader', new.preheader where new.preheader is not null
    union all
    select 2 + text_block.ordinality, 'block ' || text_block.ordinality, text_block.block ->> 'text'
    from jsonb_array_elements(new.content -> 'blocks') with ordinality as text_block(block, ordinality)
    where text_block.block ->> 'type' in ('heading', 'paragraph', 'button')
    order by 1
  loop
    foreach tag_path in array private.email_merge_tag_paths(new.organization_id, tag_location, tag_text) loop
      continue when tag_path not like 'custom.%';
      perform 1 from public.email_custom_field_definitions as field
      where field.organization_id = new.organization_id
        and field.key = substr(tag_path, 8)
        and field.status = 'active'
      for share;
      if not found then
        perform private.email_content_invalid(tag_location, 'unknown merge tag: ' || tag_path);
      end if;
    end loop;
  end loop;
  new.content_sha256 := private.email_template_content_hash(new.subject, new.preheader, new.content);
  new.merge_tag_count := cardinality(merge_tags);
  new.merge_tags_sha256 := encode(sha256(convert_to(to_jsonb(merge_tags)::text, 'UTF8')), 'hex');
  new.created_at := now();
  return new;
end;
$$;

create trigger email_template_versions_guard
before insert on public.email_template_versions
for each row execute function private.email_template_versions_guard();

-- Runs only for rows that were actually inserted. It advances the template
-- pointer and is the single, authoritative audit point for version creation:
-- every permitted insert path is audited exactly once, with bounded evidence
-- (merge-tag count and hash, never the list or any content). The evidence is
-- read from the immutable row, where email_template_versions_guard stored it
-- after validating; this trigger does not validate again.
create or replace function private.email_template_versions_advance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.email_templates as template
  set latest_version = new.version_number
  where template.organization_id = new.organization_id and template.id = new.template_id;
  perform private.email_write_audit(new.organization_id, 'email.template_version.created', 'template_version', new.id,
    jsonb_build_object('template_id', new.template_id, 'version_number', new.version_number,
                       'content_sha256', new.content_sha256,
                       'block_count', jsonb_array_length(new.content -> 'blocks'),
                       'merge_tag_count', new.merge_tag_count,
                       'merge_tags_sha256', new.merge_tags_sha256,
                       'created_by', new.created_by));
  return null;
end;
$$;

create trigger email_template_versions_advance
after insert on public.email_template_versions
for each row execute function private.email_template_versions_advance();

-- ---------------------------------------------------------------------------
-- RPCs: sender domains
-- ---------------------------------------------------------------------------

-- Idempotent on the active domain: a repeat returns the existing row.
-- The same domain may be registered by several organizations while
-- unverified; a later verification increment decides ownership.
-- Idempotent creates (domains, identities, templates) retry at most 3 times
-- when the conflicting active row is archived between the conflict and the
-- lookup (a concurrent archive), then fail with the retryable
-- 40001 EMAIL_CONCURRENT_MODIFICATION. They never return zero rows.
create or replace function public.email_create_sender_domain(p_domain text)
returns table (domain_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_senders');
  normalized text := private.email_normalize_domain(p_domain);
  created_id uuid;
  existing_id uuid;
  attempt integer;
begin
  if normalized is null then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_DOMAIN';
  end if;
  for attempt in 1..3 loop
    insert into public.email_sender_domains (organization_id, domain, created_by)
    values (organization, normalized, (select auth.uid()))
    on conflict (organization_id, domain) where status = 'active' do nothing
    returning id into created_id;

    if created_id is not null then
      perform private.email_write_audit(organization, 'email.sender_domain.created', 'sender_domain', created_id,
        jsonb_build_object('domain', normalized, 'verification_status', 'unverified'));
      return query select created_id, true;
      return;
    end if;
    select sender_domain.id into existing_id from public.email_sender_domains as sender_domain
    where sender_domain.organization_id = organization and sender_domain.domain = normalized
      and sender_domain.status = 'active';
    if existing_id is not null then
      return query select existing_id, false;
      return;
    end if;
  end loop;
  raise exception using errcode = '40001', message = 'EMAIL_CONCURRENT_MODIFICATION';
end;
$$;

create or replace function public.email_archive_sender_domain(p_domain_id uuid)
returns public.email_sender_domains
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_senders');
  current_row public.email_sender_domains%rowtype;
  updated_row public.email_sender_domains%rowtype;
begin
  select * into current_row from public.email_sender_domains as sender_domain
  where sender_domain.id = p_domain_id and sender_domain.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_SENDER_DOMAIN_NOT_FOUND';
  end if;
  if current_row.status = 'archived' then
    return current_row;
  end if;
  if exists (select 1 from public.email_sender_identities as identity
             where identity.organization_id = organization and identity.domain_id = current_row.id
               and identity.status = 'active') then
    raise exception using errcode = '55000', message = 'EMAIL_SENDER_DOMAIN_IN_USE';
  end if;
  update public.email_sender_domains as sender_domain
  set status = 'archived', archived_at = now(), archived_by = (select auth.uid())
  where sender_domain.id = current_row.id and sender_domain.organization_id = organization
  returning * into updated_row;
  perform private.email_write_audit(organization, 'email.sender_domain.archived', 'sender_domain', updated_row.id);
  return updated_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: sender identities
-- ---------------------------------------------------------------------------

-- Idempotent on the active address: an identical repeat returns the existing
-- identity; different display name or reply-to under the same address is a
-- conflict (use email_update_sender_identity).
create or replace function public.email_create_sender_identity(
  p_domain_id uuid,
  p_local_part text,
  p_from_name text,
  p_reply_to text default null
)
returns table (identity_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_senders');
  cleaned_local_part text := lower(btrim(p_local_part));
  cleaned_from_name text := btrim(p_from_name);
  cleaned_reply_to text;
  domain_row public.email_sender_domains%rowtype;
  sender_address text;
  created_id uuid;
  existing public.email_sender_identities%rowtype;
  attempt integer;
begin
  if cleaned_local_part is null
     or char_length(cleaned_local_part) not between 1 and 64
     or cleaned_local_part !~ '^[a-z0-9]([a-z0-9._+-]{0,62}[a-z0-9])?$'
     or cleaned_local_part like '%..%'
     or not private.email_from_name_is_valid(cleaned_from_name) then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  if nullif(btrim(p_reply_to), '') is not null then
    cleaned_reply_to := private.email_normalize_address(p_reply_to);
    if cleaned_reply_to is null then
      raise exception using errcode = '22023', message = 'EMAIL_INVALID_ADDRESS';
    end if;
  end if;

  select * into domain_row from public.email_sender_domains as sender_domain
  where sender_domain.id = p_domain_id and sender_domain.organization_id = organization for share;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_SENDER_DOMAIN_NOT_FOUND';
  end if;
  if domain_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_SENDER_DOMAIN_ARCHIVED';
  end if;
  sender_address := cleaned_local_part || '@' || domain_row.domain;
  if private.email_normalize_address(sender_address) is distinct from sender_address then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ADDRESS';
  end if;

  for attempt in 1..3 loop
    insert into public.email_sender_identities (
      organization_id, domain_id, local_part, address, from_name, reply_to, created_by
    ) values (
      organization, domain_row.id, cleaned_local_part, sender_address, cleaned_from_name, cleaned_reply_to,
      (select auth.uid())
    )
    on conflict (organization_id, address) where status = 'active' do nothing
    returning id into created_id;

    if created_id is not null then
      perform private.email_write_audit(organization, 'email.sender_identity.created', 'sender_identity', created_id,
        jsonb_strip_nulls(jsonb_build_object(
          'domain_id', domain_row.id,
          'address_hash', private.email_address_hash(sender_address),
          'reply_to_hash', case when cleaned_reply_to is not null then private.email_address_hash(cleaned_reply_to) end)));
      return query select created_id, true;
      return;
    end if;

    select * into existing from public.email_sender_identities as identity
    where identity.organization_id = organization and identity.address = sender_address and identity.status = 'active';
    if found then
      if existing.from_name is distinct from cleaned_from_name or existing.reply_to is distinct from cleaned_reply_to then
        raise exception using errcode = '23505', message = 'EMAIL_SENDER_IDENTITY_CONFLICT';
      end if;
      return query select existing.id, false;
      return;
    end if;
  end loop;
  raise exception using errcode = '40001', message = 'EMAIL_CONCURRENT_MODIFICATION';
end;
$$;

-- p_changes: object with any of from_name (string), reply_to (string or null).
-- The address (domain and local part) cannot be changed.
create or replace function public.email_update_sender_identity(
  p_identity_id uuid,
  p_changes jsonb,
  p_expected_version bigint default null
)
returns public.email_sender_identities
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_senders');
  current_row public.email_sender_identities%rowtype;
  updated_row public.email_sender_identities%rowtype;
  next_from_name text;
  next_reply_to text;
  changed_fields text[] := array[]::text[];
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  if exists (
    select 1 from jsonb_each(p_changes) as change
    where change.key not in ('from_name', 'reply_to')
       or (change.key = 'from_name' and jsonb_typeof(change.value) <> 'string')
       or (change.key = 'reply_to' and jsonb_typeof(change.value) not in ('string', 'null'))
  ) then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;

  select * into current_row from public.email_sender_identities as identity
  where identity.id = p_identity_id and identity.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_SENDER_IDENTITY_NOT_FOUND';
  end if;
  if current_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_SENDER_IDENTITY_ARCHIVED';
  end if;
  if p_expected_version is not null and p_expected_version <> current_row.version then
    raise exception using errcode = '40001', message = 'EMAIL_SENDER_IDENTITY_VERSION_CONFLICT';
  end if;

  next_from_name := current_row.from_name;
  if p_changes ? 'from_name' then
    next_from_name := btrim(p_changes ->> 'from_name');
    if not private.email_from_name_is_valid(next_from_name) then
      raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
    end if;
  end if;
  next_reply_to := current_row.reply_to;
  if p_changes ? 'reply_to' then
    if nullif(btrim(p_changes ->> 'reply_to'), '') is null then
      next_reply_to := null;
    else
      next_reply_to := private.email_normalize_address(p_changes ->> 'reply_to');
      if next_reply_to is null then
        raise exception using errcode = '22023', message = 'EMAIL_INVALID_ADDRESS';
      end if;
    end if;
  end if;

  if next_from_name is distinct from current_row.from_name then changed_fields := array_append(changed_fields, 'from_name'); end if;
  if next_reply_to is distinct from current_row.reply_to then changed_fields := array_append(changed_fields, 'reply_to'); end if;
  if cardinality(changed_fields) = 0 then
    return current_row;
  end if;

  update public.email_sender_identities as identity
  set from_name = next_from_name, reply_to = next_reply_to
  where identity.id = current_row.id and identity.organization_id = organization
  returning * into updated_row;
  -- A reply_to change is evidenced by the hash of the new address (never the
  -- address itself), or by reply_to_cleared when it was removed.
  perform private.email_write_audit(organization, 'email.sender_identity.updated', 'sender_identity', updated_row.id,
    jsonb_strip_nulls(jsonb_build_object(
      'changed_fields', to_jsonb(changed_fields), 'version', updated_row.version,
      'reply_to_hash', case when 'reply_to' = any (changed_fields) and next_reply_to is not null
                            then private.email_address_hash(next_reply_to) end,
      'reply_to_cleared', case when 'reply_to' = any (changed_fields) and next_reply_to is null then true end)));
  return updated_row;
end;
$$;

create or replace function public.email_archive_sender_identity(p_identity_id uuid)
returns public.email_sender_identities
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_senders');
  current_row public.email_sender_identities%rowtype;
  updated_row public.email_sender_identities%rowtype;
begin
  select * into current_row from public.email_sender_identities as identity
  where identity.id = p_identity_id and identity.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_SENDER_IDENTITY_NOT_FOUND';
  end if;
  if current_row.status = 'archived' then
    return current_row;
  end if;
  update public.email_sender_identities as identity
  set status = 'archived', archived_at = now(), archived_by = (select auth.uid())
  where identity.id = current_row.id and identity.organization_id = organization
  returning * into updated_row;
  perform private.email_write_audit(organization, 'email.sender_identity.archived', 'sender_identity', updated_row.id);
  return updated_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: templates and versions
-- ---------------------------------------------------------------------------

-- Idempotent on the active name: a repeat returns the existing template.
create or replace function public.email_create_template(
  p_name text,
  p_description text default null
)
returns table (template_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_content');
  cleaned_name text := btrim(p_name);
  cleaned_description text := nullif(btrim(p_description), '');
  created_id uuid;
  existing_id uuid;
  attempt integer;
begin
  -- Character validation is explicit and locale-independent: the Increment 2
  -- label helpers use a POSIX class whose meaning depends on the database
  -- locale, so templates validate here with the single explicit V1 set (same
  -- as the table CHECKs). Name uniqueness is NOT locale-independent: it uses
  -- name_normalized = lower(name), like Increment 2 (see the email_templates definition).
  if cleaned_name is null or char_length(cleaned_name) not between 1 and 100
     or private.email_text_has_unsafe_chars(cleaned_name, false)
     or (cleaned_description is not null and (char_length(cleaned_description) > 500
         or private.email_text_has_unsafe_chars(cleaned_description, false))) then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  for attempt in 1..3 loop
    insert into public.email_templates (organization_id, name, description, created_by)
    values (organization, cleaned_name, cleaned_description, (select auth.uid()))
    on conflict (organization_id, name_normalized) where status = 'active' do nothing
    returning id into created_id;

    if created_id is not null then
      perform private.email_write_audit(organization, 'email.template.created', 'template', created_id,
        jsonb_build_object('name', cleaned_name));
      return query select created_id, true;
      return;
    end if;
    select template.id into existing_id from public.email_templates as template
    where template.organization_id = organization and template.name_normalized = lower(cleaned_name)
      and template.status = 'active';
    if existing_id is not null then
      return query select existing_id, false;
      return;
    end if;
  end loop;
  raise exception using errcode = '40001', message = 'EMAIL_CONCURRENT_MODIFICATION';
end;
$$;

create or replace function public.email_archive_template(p_template_id uuid)
returns public.email_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_content');
  current_row public.email_templates%rowtype;
  updated_row public.email_templates%rowtype;
begin
  select * into current_row from public.email_templates as template
  where template.id = p_template_id and template.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_TEMPLATE_NOT_FOUND';
  end if;
  if current_row.status = 'archived' then
    return current_row;
  end if;
  update public.email_templates as template
  set status = 'archived', archived_at = now(), archived_by = (select auth.uid())
  where template.id = current_row.id and template.organization_id = organization
  returning * into updated_row;
  perform private.email_write_audit(organization, 'email.template.archived', 'template', updated_row.id);
  return updated_row;
end;
$$;

-- Appends the next immutable version. p_expected_latest_version is required
-- (optimistic concurrency). Idempotent: content identical to the latest
-- version returns that version (was_created = false), even when the caller's
-- expected version is stale (a retried save). The exact-retry check runs
-- before validation, so a retry keeps working after referenced state changes
-- (e.g. a custom field was archived); anything new is fully validated.
-- Otherwise a stale expected version is EMAIL_TEMPLATE_VERSION_CONFLICT.
-- The audit row is written by email_template_versions_advance (AFTER INSERT).
create or replace function public.email_create_template_version(
  p_template_id uuid,
  p_subject text,
  p_preheader text,
  p_content jsonb,
  p_expected_latest_version integer
)
returns table (version_id uuid, version_number integer, content_sha256 text, was_created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('manage_content');
  cleaned_subject text := btrim(p_subject);
  cleaned_preheader text := nullif(btrim(p_preheader), '');
  template_row public.email_templates%rowtype;
  latest public.email_template_versions%rowtype;
  payload_hash text;
  created public.email_template_versions%rowtype;
begin
  if p_expected_latest_version is null or p_expected_latest_version < 0 then
    raise exception using errcode = '22023', message = 'EMAIL_INVALID_ARGUMENT';
  end if;
  select * into template_row from public.email_templates as template
  where template.id = p_template_id and template.organization_id = organization for update;
  if not found then
    raise exception using errcode = '42501', message = 'EMAIL_TEMPLATE_NOT_FOUND';
  end if;
  if template_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'EMAIL_TEMPLATE_ARCHIVED';
  end if;

  payload_hash := private.email_template_content_hash(cleaned_subject, cleaned_preheader, p_content);
  if template_row.latest_version > 0 then
    select * into latest from public.email_template_versions as template_version
    where template_version.organization_id = organization and template_version.template_id = template_row.id
      and template_version.version_number = template_row.latest_version;
    if latest.content_sha256 = payload_hash then
      return query select latest.id, latest.version_number, latest.content_sha256, false;
      return;
    end if;
  end if;

  perform private.email_content_validate(organization, cleaned_subject, cleaned_preheader, p_content);
  if p_expected_latest_version <> template_row.latest_version then
    raise exception using errcode = '40001', message = 'EMAIL_TEMPLATE_VERSION_CONFLICT';
  end if;

  insert into public.email_template_versions (
    organization_id, template_id, version_number, subject, preheader, content, content_sha256, created_by
  ) values (
    organization, template_row.id, template_row.latest_version + 1, cleaned_subject, cleaned_preheader,
    p_content, payload_hash, (select auth.uid())
  )
  returning * into created;
  return query select created.id, created.version_number, created.content_sha256, true;
end;
$$;

-- Read-only validation for editors and future Orb capabilities. Never writes.
-- Returns { valid, content_sha256, block_count, merge_tags } or
-- { valid: false, error: 'EMAIL_INVALID_CONTENT', detail }.
create or replace function public.email_validate_content(
  p_subject text,
  p_preheader text,
  p_content jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization uuid := private.email_require('read');
  cleaned_subject text := btrim(p_subject);
  cleaned_preheader text := nullif(btrim(p_preheader), '');
  merge_tags text[];
  error_message text;
  error_detail text;
begin
  begin
    merge_tags := private.email_content_validate(organization, cleaned_subject, cleaned_preheader, p_content);
  exception when sqlstate '22023' then
    get stacked diagnostics error_message = message_text, error_detail = pg_exception_detail;
    if error_message <> 'EMAIL_INVALID_CONTENT' then
      raise;
    end if;
    return jsonb_build_object('valid', false, 'error', error_message, 'detail', error_detail);
  end;
  return jsonb_build_object(
    'valid', true,
    'content_sha256', private.email_template_content_hash(cleaned_subject, cleaned_preheader, p_content),
    'block_count', jsonb_array_length(p_content -> 'blocks'),
    'merge_tags', to_jsonb(merge_tags));
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security (read-only for founder/admin of the active organization)
-- ---------------------------------------------------------------------------

alter table public.email_sender_domains enable row level security;
alter table public.email_sender_identities enable row level security;
alter table public.email_templates enable row level security;
alter table public.email_template_versions enable row level security;

create policy email_sender_domains_select on public.email_sender_domains
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

create policy email_sender_identities_select on public.email_sender_identities
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

create policy email_templates_select on public.email_templates
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

create policy email_template_versions_select on public.email_template_versions
for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and (select private.email_can('read')));

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------

-- email_can: CREATE OR REPLACE keeps owner and ACL; both are re-asserted to be
-- explicit. Only authenticated may execute it (required by the RLS policies).
alter function private.email_can(text) owner to postgres;
revoke all on function private.email_can(text) from public, anon, authenticated, service_role;
grant execute on function private.email_can(text) to authenticated;

alter function private.email_normalize_domain(text) owner to postgres;
alter function private.email_text_has_unsafe_chars(text, boolean) owner to postgres;
alter function private.email_text_has_header_unsafe_chars(text) owner to postgres;
alter function private.email_rendered_header_is_safe(text) owner to postgres;
alter function private.email_text_has_raw_html(text) owner to postgres;
alter function private.email_from_name_is_valid(text) owner to postgres;
alter function private.email_header_text_problem(text, integer) owner to postgres;
alter function private.email_header_text_is_valid(text, integer) owner to postgres;
alter function private.email_url_is_allowed(text, boolean) owner to postgres;
alter function private.email_template_content_hash(text, text, jsonb) owner to postgres;
alter function private.email_content_invalid(text, text) owner to postgres;
alter function private.email_merge_tag_paths(uuid, text, text) owner to postgres;
alter function private.email_content_text(uuid, text, jsonb, integer, boolean) owner to postgres;
alter function private.email_json_int_between(jsonb, integer, integer) owner to postgres;
alter function private.email_content_validate(uuid, text, text, jsonb) owner to postgres;
alter function private.email_sender_domains_archive_guard() owner to postgres;
alter function private.email_sender_identities_domain_guard() owner to postgres;
alter function private.email_sender_identities_versioning() owner to postgres;
alter function private.email_templates_latest_guard() owner to postgres;
alter function private.email_template_versions_guard() owner to postgres;
alter function private.email_template_versions_advance() owner to postgres;
alter function public.email_create_sender_domain(text) owner to postgres;
alter function public.email_archive_sender_domain(uuid) owner to postgres;
alter function public.email_create_sender_identity(uuid, text, text, text) owner to postgres;
alter function public.email_update_sender_identity(uuid, jsonb, bigint) owner to postgres;
alter function public.email_archive_sender_identity(uuid) owner to postgres;
alter function public.email_create_template(text, text) owner to postgres;
alter function public.email_archive_template(uuid) owner to postgres;
alter function public.email_create_template_version(uuid, text, text, jsonb, integer) owner to postgres;
alter function public.email_validate_content(text, text, jsonb) owner to postgres;

revoke all on function private.email_normalize_domain(text) from public, anon, authenticated, service_role;
revoke all on function private.email_text_has_unsafe_chars(text, boolean) from public, anon, authenticated, service_role;
revoke all on function private.email_text_has_header_unsafe_chars(text) from public, anon, authenticated, service_role;
revoke all on function private.email_rendered_header_is_safe(text) from public, anon, authenticated, service_role;
revoke all on function private.email_text_has_raw_html(text) from public, anon, authenticated, service_role;
revoke all on function private.email_from_name_is_valid(text) from public, anon, authenticated, service_role;
revoke all on function private.email_header_text_problem(text, integer) from public, anon, authenticated, service_role;
revoke all on function private.email_header_text_is_valid(text, integer) from public, anon, authenticated, service_role;
revoke all on function private.email_url_is_allowed(text, boolean) from public, anon, authenticated, service_role;
revoke all on function private.email_template_content_hash(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.email_content_invalid(text, text) from public, anon, authenticated, service_role;
revoke all on function private.email_merge_tag_paths(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.email_content_text(uuid, text, jsonb, integer, boolean) from public, anon, authenticated, service_role;
revoke all on function private.email_json_int_between(jsonb, integer, integer) from public, anon, authenticated, service_role;
revoke all on function private.email_content_validate(uuid, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.email_sender_domains_archive_guard() from public, anon, authenticated, service_role;
revoke all on function private.email_sender_identities_domain_guard() from public, anon, authenticated, service_role;
revoke all on function private.email_sender_identities_versioning() from public, anon, authenticated, service_role;
revoke all on function private.email_templates_latest_guard() from public, anon, authenticated, service_role;
revoke all on function private.email_template_versions_guard() from public, anon, authenticated, service_role;
revoke all on function private.email_template_versions_advance() from public, anon, authenticated, service_role;

revoke all on function public.email_create_sender_domain(text) from public, anon, authenticated, service_role;
revoke all on function public.email_archive_sender_domain(uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_create_sender_identity(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.email_update_sender_identity(uuid, jsonb, bigint) from public, anon, authenticated, service_role;
revoke all on function public.email_archive_sender_identity(uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_create_template(text, text) from public, anon, authenticated, service_role;
revoke all on function public.email_archive_template(uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_create_template_version(uuid, text, text, jsonb, integer) from public, anon, authenticated, service_role;
revoke all on function public.email_validate_content(text, text, jsonb) from public, anon, authenticated, service_role;

grant execute on function public.email_create_sender_domain(text) to authenticated;
grant execute on function public.email_archive_sender_domain(uuid) to authenticated;
grant execute on function public.email_create_sender_identity(uuid, text, text, text) to authenticated;
grant execute on function public.email_update_sender_identity(uuid, jsonb, bigint) to authenticated;
grant execute on function public.email_archive_sender_identity(uuid) to authenticated;
grant execute on function public.email_create_template(text, text) to authenticated;
grant execute on function public.email_archive_template(uuid) to authenticated;
grant execute on function public.email_create_template_version(uuid, text, text, jsonb, integer) to authenticated;
grant execute on function public.email_validate_content(text, text, jsonb) to authenticated;

revoke all on table public.email_sender_domains, public.email_sender_identities,
  public.email_templates, public.email_template_versions
  from public, anon, authenticated, service_role;
grant select on table public.email_sender_domains, public.email_sender_identities,
  public.email_templates, public.email_template_versions
  to authenticated, service_role;

comment on table public.email_sender_domains is
  'Sender domains registered by an organization. Never verified in Increment 3a (no DNS); verification states are reserved.';
comment on table public.email_template_versions is
  'Append-only template versions (email-content.v1). Immutable for every role; content_sha256 is computed server-side.';
comment on function public.email_validate_content(text, text, jsonb) is
  'Read-only email-content.v1 validation. Never writes.';
