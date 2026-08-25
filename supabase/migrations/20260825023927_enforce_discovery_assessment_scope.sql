create or replace function private.enforce_discovery_assessment_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  template_division_id uuid;
begin
  if new.client_id is not null and not exists (
    select 1
    from public.clients client
    where client.id = new.client_id
      and client.organization_id = new.organization_id
  ) then
    raise exception 'Discovery client must belong to the assessment organization'
      using errcode = '23514';
  end if;

  if new.discovery_template_id is not null then
    select template.division_id
      into template_division_id
    from public.discovery_templates template
    where template.id = new.discovery_template_id
      and template.organization_id = new.organization_id;

    if not found then
      raise exception 'Discovery template must belong to the assessment organization'
        using errcode = '23514';
    end if;

    if template_division_id is not null
       and new.division_id is distinct from template_division_id then
      raise exception 'Discovery assessment division must match its template division'
        using errcode = '23514';
    end if;
  end if;

  if new.division_id is not null and not exists (
    select 1
    from public.divisions division
    where division.id = new.division_id
      and division.organization_id = new.organization_id
  ) then
    raise exception 'Discovery division must belong to the assessment organization'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_discovery_assessment_scope() from public;
revoke all on function private.enforce_discovery_assessment_scope() from anon;
revoke all on function private.enforce_discovery_assessment_scope() from authenticated;

drop trigger if exists enforce_discovery_assessment_scope_trigger
  on public.discovery_assessments;

create trigger enforce_discovery_assessment_scope_trigger
before insert or update of organization_id, client_id, discovery_template_id, division_id
on public.discovery_assessments
for each row
execute function private.enforce_discovery_assessment_scope();
