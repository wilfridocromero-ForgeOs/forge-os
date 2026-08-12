-- Exact historical SQL recovered read-only from
-- supabase_migrations.schema_migrations (20260804053330 / create_score_builder_definitions).
-- The migration is already applied remotely. Do not execute it manually
-- against production; this copy is for local history reconciliation only.


create table if not exists public.score_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  area_id uuid not null references public.work_areas(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft','published','archived')),
  version integer not null default 1 check (version > 0),
  max_score integer not null default 1000 check (max_score = 1000),
  created_by uuid not null references public.users(id),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.score_categories (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.score_templates(id) on delete cascade,
  name text not null,
  description text not null default '',
  weight numeric(5,2) not null default 0 check (weight >= 0 and weight <= 100),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.score_questions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.score_categories(id) on delete cascade,
  prompt text not null,
  help_text text not null default '',
  response_type text not null default 'scale' check (response_type in ('scale','yes_no')),
  weight numeric(5,2) not null default 0 check (weight >= 0 and weight <= 100),
  required boolean not null default true,
  position integer not null default 0,
  scale_min integer not null default 1,
  scale_max integer not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scale_min < scale_max)
);

create index if not exists score_templates_org_area_idx on public.score_templates(organization_id, area_id, status);
create index if not exists score_categories_template_idx on public.score_categories(template_id, position);
create index if not exists score_questions_category_idx on public.score_questions(category_id, position);

alter table public.score_templates enable row level security;
alter table public.score_categories enable row level security;
alter table public.score_questions enable row level security;

drop policy if exists "score_templates_read_org" on public.score_templates;
create policy "score_templates_read_org" on public.score_templates
for select to authenticated
using (organization_id = (select public.current_user_organization_id()));

drop policy if exists "score_templates_manage_org" on public.score_templates;
create policy "score_templates_manage_org" on public.score_templates
for all to authenticated
using ((select public.can_manage_organization(organization_id)))
with check (
  (select public.can_manage_organization(organization_id))
  and created_by = (select auth.uid())
  and exists (
    select 1 from public.work_areas wa
    where wa.id = area_id and wa.organization_id = organization_id
  )
);

drop policy if exists "score_categories_read_org" on public.score_categories;
create policy "score_categories_read_org" on public.score_categories
for select to authenticated
using (exists (
  select 1 from public.score_templates st
  where st.id = template_id
    and st.organization_id = (select public.current_user_organization_id())
));

drop policy if exists "score_categories_manage_org" on public.score_categories;
create policy "score_categories_manage_org" on public.score_categories
for all to authenticated
using (exists (
  select 1 from public.score_templates st
  where st.id = template_id and (select public.can_manage_organization(st.organization_id))
))
with check (exists (
  select 1 from public.score_templates st
  where st.id = template_id and (select public.can_manage_organization(st.organization_id))
));

drop policy if exists "score_questions_read_org" on public.score_questions;
create policy "score_questions_read_org" on public.score_questions
for select to authenticated
using (exists (
  select 1
  from public.score_categories sc
  join public.score_templates st on st.id = sc.template_id
  where sc.id = category_id
    and st.organization_id = (select public.current_user_organization_id())
));

drop policy if exists "score_questions_manage_org" on public.score_questions;
create policy "score_questions_manage_org" on public.score_questions
for all to authenticated
using (exists (
  select 1
  from public.score_categories sc
  join public.score_templates st on st.id = sc.template_id
  where sc.id = category_id and (select public.can_manage_organization(st.organization_id))
))
with check (exists (
  select 1
  from public.score_categories sc
  join public.score_templates st on st.id = sc.template_id
  where sc.id = category_id and (select public.can_manage_organization(st.organization_id))
));

revoke all on public.score_templates, public.score_categories, public.score_questions from anon;
grant select, insert, update, delete on public.score_templates, public.score_categories, public.score_questions to authenticated;

