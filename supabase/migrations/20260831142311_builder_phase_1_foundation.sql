-- Builder Phase 1: organization-isolated growth-system graph foundation.

alter table public.member_module_access
  drop constraint member_module_access_module_key_check;
alter table public.member_module_access
  add constraint member_module_access_module_key_check
  check (module_key = any (array['dashboard','clients','discovery','projects','area_score','playbooks','builder']::text[]));

create table public.growth_systems (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  objective text not null check (char_length(btrim(objective)) between 1 and 600),
  lifecycle text not null default 'draft' check (lifecycle in ('draft','ready','archived')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, id)
);

create table public.growth_system_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  system_id uuid not null,
  revision_number integer not null default 1 check (revision_number > 0),
  state text not null default 'draft' check (state in ('draft','sealed')),
  lock_version bigint not null default 1 check (lock_version > 0),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (system_id, revision_number),
  unique (organization_id, system_id, id),
  foreign key (organization_id, system_id) references public.growth_systems(organization_id, id) on delete cascade
);

create table public.growth_system_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  system_id uuid not null,
  revision_id uuid not null,
  node_type text not null check (node_type in ('traffic_source','landing_page','form','lead_handoff')),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  configuration jsonb not null default '{"config_version":1}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, revision_id, id),
  foreign key (organization_id, system_id, revision_id) references public.growth_system_revisions(organization_id, system_id, id) on delete cascade,
  check (jsonb_typeof(configuration) = 'object' and configuration @> '{"config_version":1}'::jsonb)
);

create table public.growth_system_edges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  system_id uuid not null,
  revision_id uuid not null,
  source_node_id uuid not null,
  target_node_id uuid not null,
  created_at timestamptz not null default now(),
  unique (revision_id, source_node_id, target_node_id),
  foreign key (organization_id, system_id, revision_id) references public.growth_system_revisions(organization_id, system_id, id) on delete cascade,
  foreign key (organization_id, revision_id, source_node_id) references public.growth_system_nodes(organization_id, revision_id, id) on delete cascade,
  foreign key (organization_id, revision_id, target_node_id) references public.growth_system_nodes(organization_id, revision_id, id) on delete cascade,
  check (source_node_id <> target_node_id)
);

create index growth_systems_org_lifecycle_idx on public.growth_systems(organization_id, lifecycle, updated_at desc);
create index growth_system_revisions_system_idx on public.growth_system_revisions(organization_id, system_id, state);
create index growth_system_nodes_revision_idx on public.growth_system_nodes(organization_id, revision_id);
create index growth_system_edges_revision_idx on public.growth_system_edges(organization_id, revision_id);

create or replace function public.builder_edge_is_acyclic()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare source_type text; target_type text;
begin
  select node_type into source_type from public.growth_system_nodes where id=new.source_node_id and revision_id=new.revision_id;
  select node_type into target_type from public.growth_system_nodes where id=new.target_node_id and revision_id=new.revision_id;
  if not ((source_type='traffic_source' and target_type='landing_page') or (source_type='landing_page' and target_type='form') or (source_type='form' and target_type='lead_handoff')) then
    raise exception using errcode='23514', message='BUILDER_INVALID_RELATIONSHIP';
  end if;
  if exists (
    with recursive reachable(id) as (
      select new.target_node_id
      union
      select edge.target_node_id from public.growth_system_edges edge join reachable on edge.source_node_id = reachable.id
      where edge.revision_id = new.revision_id
    ) select 1 from reachable where id = new.source_node_id
  ) then raise exception using errcode='23514', message='BUILDER_CYCLE_NOT_ALLOWED'; end if;
  return new;
end; $$;

create trigger growth_system_edges_prevent_cycles before insert or update on public.growth_system_edges
for each row execute function public.builder_edge_is_acyclic();

create or replace function public.builder_validate_ready_transition()
returns trigger language plpgsql security invoker set search_path='' as $$
declare draft_revision uuid; node_count integer; source_count integer; terminal_count integer; orphan_count integer;
begin
  if new.lifecycle='ready' and old.lifecycle is distinct from 'ready' then
    select id into draft_revision from public.growth_system_revisions where system_id=new.id and organization_id=new.organization_id and state='draft' order by revision_number desc limit 1;
    select count(*), count(*) filter(where node_type='traffic_source'), count(*) filter(where node_type='lead_handoff') into node_count,source_count,terminal_count from public.growth_system_nodes where revision_id=draft_revision;
    select count(*) into orphan_count from public.growth_system_nodes node where node.revision_id=draft_revision and ((node.node_type<>'traffic_source' and not exists(select 1 from public.growth_system_edges edge where edge.revision_id=draft_revision and edge.target_node_id=node.id)) or (node.node_type<>'lead_handoff' and not exists(select 1 from public.growth_system_edges edge where edge.revision_id=draft_revision and edge.source_node_id=node.id)));
    if node_count=0 or source_count=0 or terminal_count=0 or orphan_count>0 then raise exception using errcode='23514', message='BUILDER_GRAPH_NOT_READY'; end if;
  end if;
  new.updated_at=now(); return new;
end; $$;
create trigger growth_systems_validate_ready before update on public.growth_systems for each row execute function public.builder_validate_ready_transition();

alter table public.growth_systems enable row level security;
alter table public.growth_system_revisions enable row level security;
alter table public.growth_system_nodes enable row level security;
alter table public.growth_system_edges enable row level security;

create policy growth_systems_select on public.growth_systems for select to authenticated
using (organization_id = (select public.current_user_organization_id()) and ((select public.can_manage_organization(organization_id)) or exists (select 1 from public.member_module_access a where a.user_id=(select auth.uid()) and a.module_key='builder' and a.enabled)));
create policy growth_systems_insert on public.growth_systems for insert to authenticated
with check ((select public.can_manage_organization(organization_id)) and organization_id=(select public.current_user_organization_id()) and created_by=(select auth.uid()));
create policy growth_systems_update on public.growth_systems for update to authenticated
using ((select public.can_manage_organization(organization_id)))
with check ((select public.can_manage_organization(organization_id)) and organization_id=(select public.current_user_organization_id()));

create policy growth_system_revisions_select on public.growth_system_revisions for select to authenticated
using (exists (select 1 from public.growth_systems s where s.id=system_id and s.organization_id=organization_id));
create policy growth_system_revisions_manage on public.growth_system_revisions for all to authenticated
using ((select public.can_manage_organization(organization_id)) and state='draft')
with check ((select public.can_manage_organization(organization_id)) and organization_id=(select public.current_user_organization_id()) and created_by=(select auth.uid()) and state='draft');

create policy growth_system_nodes_select on public.growth_system_nodes for select to authenticated
using (exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.organization_id=organization_id));
create policy growth_system_nodes_manage on public.growth_system_nodes for all to authenticated
using ((select public.can_manage_organization(organization_id)) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.organization_id=organization_id and r.state='draft'))
with check ((select public.can_manage_organization(organization_id)) and organization_id=(select public.current_user_organization_id()) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.system_id=system_id and r.organization_id=organization_id and r.state='draft'));

create policy growth_system_edges_select on public.growth_system_edges for select to authenticated
using (exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.organization_id=organization_id));
create policy growth_system_edges_manage on public.growth_system_edges for all to authenticated
using ((select public.can_manage_organization(organization_id)) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.organization_id=organization_id and r.state='draft'))
with check ((select public.can_manage_organization(organization_id)) and organization_id=(select public.current_user_organization_id()) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.system_id=system_id and r.organization_id=organization_id and r.state='draft'));

grant select, insert, update, delete on public.growth_systems, public.growth_system_revisions, public.growth_system_nodes, public.growth_system_edges to authenticated;
revoke all on public.growth_systems, public.growth_system_revisions, public.growth_system_nodes, public.growth_system_edges from anon;
revoke execute on function public.builder_edge_is_acyclic(), public.builder_validate_ready_transition() from public, anon, authenticated;

create or replace function public.create_growth_system(system_name text, system_objective text)
returns public.growth_systems language plpgsql security invoker set search_path='' as $$
declare org_id uuid := public.current_user_organization_id(); created public.growth_systems;
begin
  if (select auth.uid()) is null or org_id is null or not public.can_manage_organization(org_id) then raise exception using errcode='42501',message='BUILDER_ACCESS_DENIED'; end if;
  insert into public.growth_systems(organization_id,name,objective,created_by) values(org_id,btrim(system_name),btrim(system_objective),(select auth.uid())) returning * into created;
  insert into public.growth_system_revisions(organization_id,system_id,created_by) values(org_id,created.id,(select auth.uid()));
  return created;
end; $$;
revoke all on function public.create_growth_system(text,text) from public, anon;
grant execute on function public.create_growth_system(text,text) to authenticated;
