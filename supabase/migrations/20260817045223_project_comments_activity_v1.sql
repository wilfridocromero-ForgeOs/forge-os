-- Projects V1 Phase 3: durable comments and human-readable activity feeds.

alter table public.project_comments
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id) on delete set null;

create index if not exists project_comments_parent_idx
  on public.project_comments (parent_id, created_at);

create or replace function public.can_comment_on_project(target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.projects p
      where p.id = target_project_id
        and p.organization_id = (select public.current_user_organization_id())
        and (
          (select public.is_platform_owner())
          or public.can_manage_organization(p.organization_id)
          or exists (
            select 1
            from public.project_members pm
            where pm.project_id = p.id
              and pm.user_id = (select auth.uid())
              and pm.role in ('owner', 'member')
          )
        )
    );
$$;

create or replace function private.validate_project_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  parent_project_id uuid;
  root_parent_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication required';
  end if;

  if tg_op = 'INSERT' then
    if new.author_id is distinct from caller_id then
      raise exception 'Comment author must match the authenticated user';
    end if;
    if not public.can_comment_on_project(new.project_id) then
      raise exception 'You cannot comment on this project';
    end if;
    new.body := trim(new.body);
    if new.parent_id is not null then
      select c.project_id, coalesce(c.parent_id, c.id)
      into parent_project_id, root_parent_id
      from public.project_comments c
      where c.id = new.parent_id;
      if parent_project_id is null then
        raise exception 'Parent comment does not exist';
      end if;
      if parent_project_id is distinct from new.project_id then
        raise exception 'Parent comment must belong to the same project';
      end if;
      new.parent_id := root_parent_id;
    end if;
    return new;
  end if;

  if new.project_id is distinct from old.project_id
     or new.author_id is distinct from old.author_id
     or new.parent_id is distinct from old.parent_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Comment identity fields are immutable';
  end if;

  if old.deleted_at is not null then
    raise exception 'Deleted comments are immutable';
  end if;

  if new.deleted_at is not null then
    if caller_id is distinct from old.author_id
       and not public.can_manage_project_membership(old.project_id) then
      raise exception 'You cannot delete this comment';
    end if;
    new.deleted_at := now();
    new.deleted_by := caller_id;
    new.body := '[deleted]';
    new.edited_at := old.edited_at;
    return new;
  end if;

  if new.deleted_by is distinct from old.deleted_by then
    raise exception 'deleted_by is managed by the backend';
  end if;
  if caller_id is distinct from old.author_id then
    raise exception 'Only the author can edit a comment';
  end if;
  new.body := trim(new.body);
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end;
$$;

create or replace function private.record_project_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  activity_event text;
begin
  if tg_op = 'INSERT' then
    activity_event := 'comment_added';
  elsif old.deleted_at is null and new.deleted_at is not null then
    activity_event := 'comment_deleted';
  elsif old.body is distinct from new.body then
    activity_event := 'comment_edited';
  else
    return new;
  end if;

  insert into public.project_activity (
    project_id, actor_id, event_type, entity_type, entity_id, payload
  ) values (
    new.project_id,
    (select auth.uid()),
    activity_event,
    'comment',
    new.id::text,
    jsonb_build_object('comment_id', new.id, 'parent_id', new.parent_id)
  );
  return new;
end;
$$;

drop trigger if exists validate_project_comment_trigger on public.project_comments;
create trigger validate_project_comment_trigger
before insert or update on public.project_comments
for each row execute function private.validate_project_comment();

drop trigger if exists record_project_comment_activity_trigger on public.project_comments;
create trigger record_project_comment_activity_trigger
after insert or update on public.project_comments
for each row execute function private.record_project_comment_activity();

drop policy if exists "Project members create comments" on public.project_comments;
create policy "Project participants create comments"
on public.project_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and public.can_comment_on_project(project_id)
);

drop policy if exists "Authors update comments" on public.project_comments;
create policy "Authors and managers update comments"
on public.project_comments for update to authenticated
using (
  author_id = (select auth.uid())
  or public.can_manage_project_membership(project_id)
)
with check (
  author_id = (select auth.uid())
  or public.can_manage_project_membership(project_id)
);

drop policy if exists "Authors delete comments" on public.project_comments;

revoke all on table public.project_comments from anon, authenticated;
grant select, insert, update on table public.project_comments to authenticated;

revoke all on function public.can_comment_on_project(uuid) from public, anon;
grant execute on function public.can_comment_on_project(uuid) to authenticated;
revoke all on function private.validate_project_comment() from public, anon, authenticated;
revoke all on function private.record_project_comment_activity() from public, anon, authenticated;

create or replace function public.get_project_comments(target_project_id uuid)
returns table (
  id uuid,
  project_id uuid,
  author_id uuid,
  author_name text,
  body text,
  parent_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.project_id, c.author_id, coalesce(u.first_name, 'Usuario'),
         case when c.deleted_at is null then c.body else null end,
         c.parent_id, c.created_at, c.updated_at, c.edited_at, c.deleted_at, c.deleted_by
  from public.project_comments c
  left join public.users u on u.id = c.author_id
  where c.project_id = target_project_id
    and exists (
      select 1 from public.projects p
      where p.id = target_project_id
        and p.organization_id = (select public.current_user_organization_id())
    )
  order by c.created_at, c.id;
$$;

create or replace function public.get_project_activity_page(
  target_project_id uuid,
  before_activity_id bigint default null,
  page_size integer default 30
)
returns table (
  id bigint,
  project_id uuid,
  actor_id uuid,
  actor_name text,
  event_type text,
  entity_type text,
  entity_id text,
  payload jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.project_id, a.actor_id,
         case when a.actor_id is null then 'Sistema' else coalesce(u.first_name, 'Usuario') end,
         a.event_type, a.entity_type, a.entity_id,
         case
           when a.entity_type = 'project_member' then
             a.payload || jsonb_build_object('affected_user_name', affected.first_name)
           else a.payload
         end,
         a.created_at
  from public.project_activity a
  left join public.users u on u.id = a.actor_id
  left join public.users affected
    on a.entity_type = 'project_member' and affected.id::text = a.entity_id
  where a.project_id = target_project_id
    and (before_activity_id is null or a.id < before_activity_id)
    and exists (
      select 1 from public.projects p
      where p.id = target_project_id
        and p.organization_id = (select public.current_user_organization_id())
    )
  order by a.id desc
  limit least(greatest(page_size, 1), 50);
$$;

revoke all on function public.get_project_comments(uuid) from public, anon;
grant execute on function public.get_project_comments(uuid) to authenticated;
revoke all on function public.get_project_activity_page(uuid, bigint, integer) from public, anon;
grant execute on function public.get_project_activity_page(uuid, bigint, integer) to authenticated;
