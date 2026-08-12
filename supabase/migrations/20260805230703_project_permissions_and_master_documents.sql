-- Recovered historical artifact for remote migration 20260805230703.
-- Its objects were verified against the current remote PostgreSQL catalogs.
-- This file is prepared only to reconcile local version control. The objects
-- already exist remotely; do not execute it manually against production.

-- Follow-up hardening for operational project work and master knowledge documents.

alter table public.knowledge_documents
  drop constraint if exists knowledge_documents_document_type_check;
alter table public.knowledge_documents
  add constraint knowledge_documents_document_type_check
  check (document_type in ('master','sop','playbook','policy','template','reference'));

drop policy if exists "Project members update tasks" on public.project_tasks;
create policy "Project members update tasks" on public.project_tasks
for update to authenticated
using (
  created_by = (select auth.uid())
  or assigned_to = (select auth.uid())
  or exists (
    select 1 from public.projects p
    where p.id = project_id and public.can_manage_organization(p.organization_id)
  )
)
with check (
  exists (
    select 1 from public.projects p
    where p.id = project_id
      and p.organization_id = (select public.current_user_organization_id())
  )
);

drop policy if exists "Project managers delete tasks" on public.project_tasks;
create policy "Project managers delete tasks" on public.project_tasks
for delete to authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1 from public.projects p
    where p.id = project_id and public.can_manage_organization(p.organization_id)
  )
);

drop policy if exists "Project owners update deliverables" on public.project_deliverables;
create policy "Project owners update deliverables" on public.project_deliverables
for update to authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1 from public.projects p
    where p.id = project_id and public.can_manage_organization(p.organization_id)
  )
)
with check (
  exists (
    select 1 from public.projects p
    where p.id = project_id
      and p.organization_id = (select public.current_user_organization_id())
  )
);

drop policy if exists "Project owners delete deliverables" on public.project_deliverables;
create policy "Project owners delete deliverables" on public.project_deliverables
for delete to authenticated
using (
  created_by = (select auth.uid())
  or exists (
    select 1 from public.projects p
    where p.id = project_id and public.can_manage_organization(p.organization_id)
  )
);
