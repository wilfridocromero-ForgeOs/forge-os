-- Recovered historical artifact for remote migration 20260805043427.
-- Its objects were verified against the current remote PostgreSQL catalogs.
-- This file is prepared only to reconcile local version control. The objects
-- already exist remotely; do not execute it manually against production.

-- ORVESEN Phase 2: definitive Projects foundation.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

alter table public.projects
  add column if not exists description text,
  add column if not exists priority text not null default 'medium',
  add column if not exists starts_at timestamptz,
  add column if not exists created_by uuid references public.users(id);

update public.projects set created_by = coalesce(created_by, owner_id) where created_by is null;

do $$ begin
  alter table public.projects add constraint projects_name_length check (char_length(trim(name)) between 2 and 160);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.projects add constraint projects_priority_check check (priority in ('low','medium','high','urgent'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.projects add constraint projects_dates_check check (due_at is null or starts_at is null or due_at >= starts_at);
exception when duplicate_object then null; end $$;

create index if not exists projects_org_status_idx on public.projects(organization_id, status);
create index if not exists projects_org_due_idx on public.projects(organization_id, due_at);
create index if not exists projects_division_idx on public.projects(division_id);
create index if not exists projects_client_idx on public.projects(client_id);
create index if not exists projects_owner_idx on public.projects(owner_id);

drop policy if exists "Organization members delete projects" on public.projects;
drop policy if exists "Organization members insert projects" on public.projects;
drop policy if exists "Organization members update projects" on public.projects;

create policy "Organization members create projects" on public.projects for insert to authenticated
with check (
  organization_id = (select public.current_user_organization_id())
  and created_by = (select auth.uid())
  and exists (select 1 from public.divisions d where d.id = division_id and d.organization_id = organization_id and d.active)
);
create policy "Project owners and managers update projects" on public.projects for update to authenticated
using (organization_id = (select public.current_user_organization_id()) and (owner_id = (select auth.uid()) or created_by = (select auth.uid()) or (select public.is_platform_owner()) or public.can_manage_organization(organization_id)))
with check (organization_id = (select public.current_user_organization_id()) and exists (select 1 from public.divisions d where d.id = division_id and d.organization_id = organization_id and d.active));
create policy "Project managers delete projects" on public.projects for delete to authenticated
using (organization_id = (select public.current_user_organization_id()) and (created_by = (select auth.uid()) or (select public.is_platform_owner()) or public.can_manage_organization(organization_id)));

create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 180), description text,
  status text not null default 'pending' check (status in ('pending','in_progress','blocked','completed','cancelled')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  assigned_to uuid references public.users(id), due_at timestamptz, completed_at timestamptz,
  created_by uuid not null references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.project_comments (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.users(id), body text not null check (char_length(trim(body)) between 1 and 5000),
  parent_id uuid references public.project_comments(id) on delete cascade, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  storage_path text not null, file_name text not null, mime_type text, size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid not null references public.users(id), created_at timestamptz not null default now(), unique(project_id, storage_path)
);
create table if not exists public.project_deliverables (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 2 and 180), description text,
  status text not null default 'pending' check (status in ('pending','in_review','approved','rejected','delivered')),
  due_at timestamptz, approved_by uuid references public.users(id), approved_at timestamptz,
  created_by uuid not null references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.project_activity (
  id bigint generated by default as identity primary key, project_id uuid not null references public.projects(id) on delete cascade,
  actor_id uuid references public.users(id), event_type text not null, entity_type text not null default 'project', entity_id text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'), created_at timestamptz not null default now()
);
create table if not exists public.project_automations (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
  name text not null, trigger_type text not null, action_type text not null,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'), enabled boolean not null default true,
  created_by uuid not null references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists project_tasks_project_idx on public.project_tasks(project_id);
create index if not exists project_tasks_assigned_idx on public.project_tasks(assigned_to, status);
create index if not exists project_comments_project_idx on public.project_comments(project_id, created_at);
create index if not exists project_files_project_idx on public.project_files(project_id);
create index if not exists project_deliverables_project_idx on public.project_deliverables(project_id, status);
create index if not exists project_activity_project_idx on public.project_activity(project_id, created_at desc);
create index if not exists project_automations_project_idx on public.project_automations(project_id);

alter table public.project_tasks enable row level security;
alter table public.project_comments enable row level security;
alter table public.project_files enable row level security;
alter table public.project_deliverables enable row level security;
alter table public.project_activity enable row level security;
alter table public.project_automations enable row level security;
grant select, insert, update, delete on public.project_tasks, public.project_comments, public.project_files, public.project_deliverables, public.project_automations to authenticated;
grant select, insert on public.project_activity to authenticated;
grant usage, select on sequence public.project_activity_id_seq to authenticated;

do $policies$
declare t text;
begin
  foreach t in array array['project_tasks','project_comments','project_files','project_deliverables','project_activity','project_automations'] loop
    execute format('drop policy if exists "Project members read %1$s" on public.%1$I', t);
    execute format('create policy "Project members read %1$s" on public.%1$I for select to authenticated using (exists (select 1 from public.projects p where p.id = project_id and (p.organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()))))', t);
  end loop;
end $policies$;

create policy "Project members create tasks" on public.project_tasks for insert to authenticated with check (created_by=(select auth.uid()) and exists (select 1 from public.projects p where p.id=project_id and p.organization_id=(select public.current_user_organization_id())));
create policy "Project members update tasks" on public.project_tasks for update to authenticated using (created_by=(select auth.uid()) or assigned_to=(select auth.uid()) or (select public.is_platform_owner())) with check (exists (select 1 from public.projects p where p.id=project_id and p.organization_id=(select public.current_user_organization_id())));
create policy "Project managers delete tasks" on public.project_tasks for delete to authenticated using (created_by=(select auth.uid()) or (select public.is_platform_owner()));
create policy "Project members create comments" on public.project_comments for insert to authenticated with check (author_id=(select auth.uid()) and exists (select 1 from public.projects p where p.id=project_id and p.organization_id=(select public.current_user_organization_id())));
create policy "Authors update comments" on public.project_comments for update to authenticated using (author_id=(select auth.uid())) with check (author_id=(select auth.uid()));
create policy "Authors delete comments" on public.project_comments for delete to authenticated using (author_id=(select auth.uid()) or (select public.is_platform_owner()));
create policy "Project members upload files" on public.project_files for insert to authenticated with check (uploaded_by=(select auth.uid()) and exists (select 1 from public.projects p where p.id=project_id and p.organization_id=(select public.current_user_organization_id())));
create policy "Uploaders delete files" on public.project_files for delete to authenticated using (uploaded_by=(select auth.uid()) or (select public.is_platform_owner()));
create policy "Project members create deliverables" on public.project_deliverables for insert to authenticated with check (created_by=(select auth.uid()) and exists (select 1 from public.projects p where p.id=project_id and p.organization_id=(select public.current_user_organization_id())));
create policy "Project owners update deliverables" on public.project_deliverables for update to authenticated using (created_by=(select auth.uid()) or (select public.is_platform_owner())) with check (true);
create policy "Project owners delete deliverables" on public.project_deliverables for delete to authenticated using (created_by=(select auth.uid()) or (select public.is_platform_owner()));
create policy "Project members append activity" on public.project_activity for insert to authenticated with check ((actor_id=(select auth.uid()) or actor_id is null) and exists (select 1 from public.projects p where p.id=project_id and p.organization_id=(select public.current_user_organization_id())));
create policy "Project managers create automations" on public.project_automations for insert to authenticated with check (created_by=(select auth.uid()) and exists (select 1 from public.projects p where p.id=project_id and (public.can_manage_organization(p.organization_id) or (select public.is_platform_owner()))));
create policy "Project managers update automations" on public.project_automations for update to authenticated using (created_by=(select auth.uid()) or (select public.is_platform_owner())) with check (true);
create policy "Project managers delete automations" on public.project_automations for delete to authenticated using (created_by=(select auth.uid()) or (select public.is_platform_owner()));

create trigger set_project_tasks_updated_at before update on public.project_tasks for each row execute function public.set_updated_at();
create trigger set_project_comments_updated_at before update on public.project_comments for each row execute function public.set_updated_at();
create trigger set_project_deliverables_updated_at before update on public.project_deliverables for each row execute function public.set_updated_at();
create trigger set_project_automations_updated_at before update on public.project_automations for each row execute function public.set_updated_at();
