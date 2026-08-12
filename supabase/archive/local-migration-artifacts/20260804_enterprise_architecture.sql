-- ORVESEN enterprise architecture: centralized divisions, live scores and knowledge library.

create table if not exists public.divisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug),
  unique (organization_id, name)
);

alter table public.divisions enable row level security;
grant select, insert, update, delete on public.divisions to authenticated;

drop policy if exists "Members can read organization divisions" on public.divisions;
create policy "Members can read organization divisions" on public.divisions for select to authenticated
using (organization_id = (select public.current_user_organization_id()) or (select public.is_platform_owner()));
drop policy if exists "Managers can create organization divisions" on public.divisions;
create policy "Managers can create organization divisions" on public.divisions for insert to authenticated
with check (organization_id = (select public.current_user_organization_id()) and exists (
  select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('platform_owner','organization_admin')
));
drop policy if exists "Managers can update organization divisions" on public.divisions;
create policy "Managers can update organization divisions" on public.divisions for update to authenticated
using (organization_id = (select public.current_user_organization_id()) and exists (
  select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('platform_owner','organization_admin')
)) with check (organization_id = (select public.current_user_organization_id()));
drop policy if exists "Managers can delete organization divisions" on public.divisions;
create policy "Managers can delete organization divisions" on public.divisions for delete to authenticated
using (organization_id = (select public.current_user_organization_id()) and exists (
  select 1 from public.users u where u.id = (select auth.uid()) and u.role in ('platform_owner','organization_admin')
));

insert into public.divisions (organization_id, name, slug, position)
select o.id, seed.name, seed.slug, seed.position
from public.organizations o
cross join (values
  ('ORVESEN Digital','orvesen-digital',1),
  ('ORVESEN Studio','orvesen-studio',2),
  ('ORVESEN Media','orvesen-media',3),
  ('ORVESEN Academy','orvesen-academy',4),
  ('ORVESEN OS','orvesen-os',5)
) as seed(name, slug, position)
where o.organization_type = 'internal'
on conflict (organization_id, slug) do update set name = excluded.name, position = excluded.position;

alter table public.users add column if not exists division_id uuid references public.divisions(id) on delete set null;
alter table public.user_invitations add column if not exists division_id uuid references public.divisions(id) on delete set null;
alter table public.clients add column if not exists division_id uuid references public.divisions(id) on delete set null;
alter table public.knowledge_documents add column if not exists division_id uuid references public.divisions(id) on delete set null;
alter table public.score_templates add column if not exists division_id uuid references public.divisions(id) on delete restrict;
alter table public.score_templates alter column area_id drop not null;

update public.users u set division_id = d.id
from public.divisions d where u.division_id is null and u.organization_id=d.organization_id and lower(trim(u.division))=lower(d.name);
update public.user_invitations i set division_id = d.id
from public.divisions d where i.division_id is null and i.organization_id=d.organization_id and lower(trim(i.division))=lower(d.name);
update public.knowledge_documents k set division_id = d.id
from public.divisions d where k.division_id is null and k.organization_id=d.organization_id and lower(trim(k.division))=lower(d.name);
update public.score_templates s set division_id = d.id
from public.work_areas w join public.divisions d on d.organization_id=w.organization_id and lower(d.name)=lower(w.name)
where s.area_id=w.id and s.division_id is null;

create table if not exists public.score_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete restrict,
  template_id uuid not null references public.score_templates(id) on delete cascade,
  name text not null,
  current_score numeric(12,2) not null default 0,
  max_score numeric(12,2) not null default 1000 check (max_score > 0),
  percentage numeric(7,4) not null default 0 check (percentage between 0 and 100),
  status text not null default 'pending' check (status in ('pending','critical','at_risk','developing','healthy','excellent')),
  breakdown jsonb not null default '{}'::jsonb,
  computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, organization_id, division_id)
);

create table if not exists public.score_metrics (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.score_templates(id) on delete cascade,
  category_id uuid references public.score_categories(id) on delete set null,
  code text not null check (code ~ '^[a-z0-9_]+$'),
  name text not null,
  source_type text not null check (source_type in ('project_completion','discovery','division_performance','manual_evidence')),
  weight numeric(7,4) not null check (weight >= 0 and weight <= 100),
  target_value numeric(14,4) not null default 100 check (target_value > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, code)
);

create table if not exists public.score_metric_values (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.score_instances(id) on delete cascade,
  metric_id uuid not null references public.score_metrics(id) on delete cascade,
  value numeric(14,4) not null,
  source_table text,
  source_id text,
  measured_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (instance_id, metric_id)
);

create table if not exists public.user_division_score_access (
  user_id uuid not null references public.users(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,division_id)
);
alter table public.user_division_score_access enable row level security;
grant select,insert,delete on public.user_division_score_access to authenticated;
create policy "Members read score access" on public.user_division_score_access for select to authenticated using (user_id=(select auth.uid()) or (select public.is_platform_owner()) or exists(select 1 from public.users u where u.id=(select auth.uid()) and u.role='organization_admin'));
create policy "Managers change score access" on public.user_division_score_access for all to authenticated using ((select public.is_platform_owner()) or exists(select 1 from public.users u where u.id=(select auth.uid()) and u.role='organization_admin')) with check ((select public.is_platform_owner()) or exists(select 1 from public.users u where u.id=(select auth.uid()) and u.role='organization_admin'));

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete restrict,
  client_id bigint references public.clients(id) on delete set null,
  name text not null,
  status text not null default 'planned' check (status in ('planned','active','blocked','completed','cancelled')),
  progress numeric(7,4) not null default 0 check (progress between 0 and 100),
  owner_id uuid references public.users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discovery_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  division_id uuid not null references public.divisions(id) on delete restrict,
  client_id bigint references public.clients(id) on delete cascade,
  template_id uuid references public.score_templates(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','in_progress','completed')),
  score numeric(12,2),
  max_score numeric(12,2) not null default 1000 check (max_score > 0),
  answers jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.score_instances enable row level security;
alter table public.score_metrics enable row level security;
alter table public.score_metric_values enable row level security;
alter table public.projects enable row level security;
alter table public.discovery_assessments enable row level security;
grant select, insert, update, delete on public.score_instances, public.score_metrics, public.score_metric_values, public.projects, public.discovery_assessments to authenticated;

do $$
declare t text;
begin
  foreach t in array array['score_instances','projects','discovery_assessments'] loop
    execute format('drop policy if exists "Organization members read %1$s" on public.%1$I', t);
    execute format('create policy "Organization members read %1$s" on public.%1$I for select to authenticated using (organization_id=(select public.current_user_organization_id()) or (select public.is_platform_owner()))', t);
    execute format('drop policy if exists "Organization members write %1$s" on public.%1$I', t);
    execute format('create policy "Organization members write %1$s" on public.%1$I for all to authenticated using (organization_id=(select public.current_user_organization_id())) with check (organization_id=(select public.current_user_organization_id()))', t);
  end loop;
end $$;

drop policy if exists "Members read score metrics" on public.score_metrics;
create policy "Members read score metrics" on public.score_metrics for select to authenticated using (
  exists (select 1 from public.score_templates t where t.id=template_id and (t.organization_id=(select public.current_user_organization_id()) or (select public.is_platform_owner())))
);
drop policy if exists "Managers write score metrics" on public.score_metrics;
create policy "Managers write score metrics" on public.score_metrics for all to authenticated using (
  exists (select 1 from public.score_templates t join public.users u on u.id=(select auth.uid()) where t.id=template_id and t.organization_id=u.organization_id and u.role in ('platform_owner','organization_admin'))
) with check (
  exists (select 1 from public.score_templates t join public.users u on u.id=(select auth.uid()) where t.id=template_id and t.organization_id=u.organization_id and u.role in ('platform_owner','organization_admin'))
);
drop policy if exists "Members read metric values" on public.score_metric_values;
create policy "Members read metric values" on public.score_metric_values for select to authenticated using (
  exists (select 1 from public.score_instances i where i.id=instance_id and (i.organization_id=(select public.current_user_organization_id()) or (select public.is_platform_owner())))
);
drop policy if exists "Members write metric values" on public.score_metric_values;
create policy "Members write metric values" on public.score_metric_values for all to authenticated using (
  exists (select 1 from public.score_instances i where i.id=instance_id and i.organization_id=(select public.current_user_organization_id()))
) with check (
  exists (select 1 from public.score_instances i where i.id=instance_id and i.organization_id=(select public.current_user_organization_id()))
);

create or replace function public.recalculate_score_instance(target_instance_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare total_weight numeric; weighted numeric; next_score numeric; next_max numeric; next_pct numeric;
begin
  select coalesce(sum(m.weight),0), coalesce(sum(least(greatest(v.value / m.target_value,0),1) * m.weight),0)
  into total_weight, weighted
  from public.score_metrics m left join public.score_metric_values v on v.metric_id=m.id and v.instance_id=target_instance_id
  join public.score_instances i on i.template_id=m.template_id and i.id=target_instance_id where m.active;
  select max_score into next_max from public.score_instances where id=target_instance_id;
  next_pct := case when total_weight > 0 then weighted / total_weight * 100 else 0 end;
  next_score := round(next_max * next_pct / 100, 2);
  update public.score_instances set current_score=next_score, percentage=round(next_pct,4),
    status=case when total_weight=0 then 'pending' when next_pct<40 then 'critical' when next_pct<60 then 'at_risk' when next_pct<75 then 'developing' when next_pct<90 then 'healthy' else 'excellent' end,
    computed_at=now(), updated_at=now() where id=target_instance_id;
end $$;

create or replace function public.handle_score_template_instance()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if new.division_id is not null then
    insert into public.score_instances(organization_id,division_id,template_id,name,max_score)
    values(new.organization_id,new.division_id,new.id,new.name,new.max_score)
    on conflict(template_id,organization_id,division_id) do update set name=excluded.name,max_score=excluded.max_score,updated_at=now();
  end if;
  return new;
end $$;
drop trigger if exists score_template_instance_trigger on public.score_templates;
create trigger score_template_instance_trigger after insert or update of division_id,name,max_score on public.score_templates
for each row execute function public.handle_score_template_instance();

create or replace function public.handle_metric_value_recalculation()
returns trigger language plpgsql security invoker set search_path=public as $$
begin perform public.recalculate_score_instance(coalesce(new.instance_id,old.instance_id)); return coalesce(new,old); end $$;
drop trigger if exists metric_value_recalculation_trigger on public.score_metric_values;
create trigger metric_value_recalculation_trigger after insert or update or delete on public.score_metric_values
for each row execute function public.handle_metric_value_recalculation();

create or replace function public.refresh_division_source_metrics(target_organization_id uuid, target_division_id uuid)
returns void language plpgsql security invoker set search_path=public as $$
declare metric record; calculated numeric;
begin
  for metric in
    select i.id instance_id,m.id metric_id,m.source_type
    from public.score_instances i join public.score_metrics m on m.template_id=i.template_id and m.active
    where i.organization_id=target_organization_id and i.division_id=target_division_id
  loop
    calculated := null;
    if metric.source_type='project_completion' then
      select case when count(*) filter(where status<>'cancelled')=0 then 0 else
        count(*) filter(where status='completed')::numeric / count(*) filter(where status<>'cancelled') * 100 end
      into calculated from public.projects where organization_id=target_organization_id and division_id=target_division_id;
    elsif metric.source_type='discovery' then
      select score/max_score*100 into calculated from public.discovery_assessments
      where organization_id=target_organization_id and division_id=target_division_id and status='completed' and score is not null
      order by completed_at desc nulls last,updated_at desc limit 1;
    end if;
    if calculated is not null then
      insert into public.score_metric_values(instance_id,metric_id,value,source_table,measured_at)
      values(metric.instance_id,metric.metric_id,calculated,case when metric.source_type='discovery' then 'discovery_assessments' else 'projects' end,now())
      on conflict(instance_id,metric_id) do update set value=excluded.value,source_table=excluded.source_table,measured_at=excluded.measured_at;
    end if;
  end loop;
end $$;

create or replace function public.handle_operational_score_refresh()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  perform public.refresh_division_source_metrics(coalesce(new.organization_id,old.organization_id),coalesce(new.division_id,old.division_id));
  if tg_op='UPDATE' and (old.organization_id,old.division_id) is distinct from (new.organization_id,new.division_id) then
    perform public.refresh_division_source_metrics(old.organization_id,old.division_id);
  end if;
  return coalesce(new,old);
end $$;
drop trigger if exists project_score_refresh_trigger on public.projects;
create trigger project_score_refresh_trigger after insert or update or delete on public.projects for each row execute function public.handle_operational_score_refresh();
drop trigger if exists discovery_score_refresh_trigger on public.discovery_assessments;
create trigger discovery_score_refresh_trigger after insert or update or delete on public.discovery_assessments for each row execute function public.handle_operational_score_refresh();

create table if not exists public.knowledge_folders (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid references public.knowledge_folders(id) on delete cascade, division_id uuid references public.divisions(id) on delete set null,
  name text not null check(char_length(trim(name)) between 1 and 120), created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,parent_id,name)
);
alter table public.knowledge_folders enable row level security;
grant select,insert,update,delete on public.knowledge_folders to authenticated;
drop policy if exists "Organization members manage knowledge folders" on public.knowledge_folders;
create policy "Organization members manage knowledge folders" on public.knowledge_folders for all to authenticated
using(organization_id=(select public.current_user_organization_id())) with check(organization_id=(select public.current_user_organization_id()));

alter table public.knowledge_documents add column if not exists folder_id uuid references public.knowledge_folders(id) on delete set null;
alter table public.knowledge_documents add column if not exists category text;
alter table public.knowledge_documents add column if not exists version integer not null default 1 check(version>0);
alter table public.knowledge_documents add column if not exists tags text[] not null default '{}';
alter table public.knowledge_documents add column if not exists author_name text;
alter table public.knowledge_documents drop constraint if exists knowledge_documents_status_check;
alter table public.knowledge_documents add constraint knowledge_documents_status_check check(status in ('draft','review','approved','archived'));
alter table public.knowledge_documents alter column status set default 'draft';
update public.knowledge_documents set status='approved' where status='active';

insert into public.score_instances(organization_id,division_id,template_id,name,max_score)
select s.organization_id,s.division_id,s.id,s.name,s.max_score from public.score_templates s where s.division_id is not null
on conflict(template_id,organization_id,division_id) do nothing;

create index if not exists divisions_organization_active_idx on public.divisions(organization_id,active,position);
create index if not exists score_instances_org_division_idx on public.score_instances(organization_id,division_id,computed_at desc);
create index if not exists projects_org_division_status_idx on public.projects(organization_id,division_id,status);
create index if not exists discovery_org_division_idx on public.discovery_assessments(organization_id,division_id,status);
create index if not exists knowledge_documents_org_folder_idx on public.knowledge_documents(organization_id,folder_id,created_at desc);
create index if not exists knowledge_documents_tags_idx on public.knowledge_documents using gin(tags);
create index if not exists clients_division_id_idx on public.clients(division_id);
create index if not exists users_division_id_idx on public.users(division_id);
create index if not exists score_templates_division_id_idx on public.score_templates(division_id);
create index if not exists user_invitations_division_id_idx on public.user_invitations(division_id);
create index if not exists user_division_score_access_division_idx on public.user_division_score_access(division_id);
create index if not exists discovery_assessments_client_idx on public.discovery_assessments(client_id);
create index if not exists discovery_assessments_created_by_idx on public.discovery_assessments(created_by);
create index if not exists discovery_assessments_template_idx on public.discovery_assessments(template_id);

