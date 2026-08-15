-- Break the user_area_access <-> work_areas RLS cycle and enforce that
-- administrative assignments never cross organization boundaries.

create or replace function public.can_manage_user_area_assignment(
  target_user_id uuid,
  target_area_id uuid
)
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
      from public.users as target_user
      join public.work_areas as target_area
        on target_area.organization_id = target_user.organization_id
      where target_user.id = target_user_id
        and target_area.id = target_area_id
        and public.can_manage_organization(target_user.organization_id)
    );
$$;

alter function public.can_manage_user_area_assignment(uuid, uuid) owner to postgres;
revoke all on function public.can_manage_user_area_assignment(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_manage_user_area_assignment(uuid, uuid)
  to authenticated;

alter policy "Users can view permitted area assignments"
on public.user_area_access
using (
  user_id = (select auth.uid())
  or public.can_manage_user_area_assignment(user_id, area_id)
);

alter policy "Managers can create area assignments"
on public.user_area_access
with check (
  public.can_manage_user_area_assignment(user_id, area_id)
);

alter policy "Managers can update area assignments"
on public.user_area_access
using (
  public.can_manage_user_area_assignment(user_id, area_id)
)
with check (
  public.can_manage_user_area_assignment(user_id, area_id)
);

alter policy "Managers can delete area assignments"
on public.user_area_access
using (
  public.can_manage_user_area_assignment(user_id, area_id)
);

-- Validate both sides of division score access inside SECURITY DEFINER helpers.
-- The read helper preserves legitimate self-access without exposing malformed
-- or cross-organization assignments.

create or replace function public.can_read_user_division_score_access(
  target_user_id uuid,
  target_division_id uuid
)
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
      from public.users as target_user
      join public.divisions as target_division
        on target_division.organization_id = target_user.organization_id
      where target_user.id = target_user_id
        and target_division.id = target_division_id
        and (
          target_user.id = (select auth.uid())
          or public.can_manage_organization(target_user.organization_id)
        )
    );
$$;

alter function public.can_read_user_division_score_access(uuid, uuid) owner to postgres;

create or replace function public.can_manage_user_division_score_access(
  target_user_id uuid,
  target_division_id uuid
)
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
      from public.users as target_user
      join public.divisions as target_division
        on target_division.organization_id = target_user.organization_id
      where target_user.id = target_user_id
        and target_division.id = target_division_id
        and public.can_manage_organization(target_user.organization_id)
    );
$$;

alter function public.can_manage_user_division_score_access(uuid, uuid) owner to postgres;
revoke all on function public.can_read_user_division_score_access(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.can_manage_user_division_score_access(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_read_user_division_score_access(uuid, uuid)
  to authenticated;
grant execute on function public.can_manage_user_division_score_access(uuid, uuid)
  to authenticated;

alter policy "Members read score access"
on public.user_division_score_access
using (
  public.can_read_user_division_score_access(user_id, division_id)
);

alter policy "Managers insert score access"
on public.user_division_score_access
with check (
  public.can_manage_user_division_score_access(user_id, division_id)
);

alter policy "Managers delete score access"
on public.user_division_score_access
using (
  public.can_manage_user_division_score_access(user_id, division_id)
);
