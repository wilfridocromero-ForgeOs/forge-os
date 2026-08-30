create or replace function private.enforce_discovery_template_division_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.division_id is not distinct from old.division_id then
    return new;
  end if;

  if exists (
    select 1
    from public.discovery_assessments assessment
    where assessment.discovery_template_id = old.id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DISCOVERY_TEMPLATE_DIVISION_LOCKED',
      detail = 'No puedes cambiar la división de esta plantilla porque ya tiene evaluaciones asociadas. Duplica la plantilla o crea una nueva versión para utilizar otra división.';
  end if;

  return new;
end;
$$;

alter function private.enforce_discovery_template_division_lock() owner to postgres;
revoke all on function private.enforce_discovery_template_division_lock() from public, anon, authenticated;

drop trigger if exists enforce_discovery_template_division_lock_trigger
on public.discovery_templates;

create trigger enforce_discovery_template_division_lock_trigger
before update of division_id on public.discovery_templates
for each row
execute function private.enforce_discovery_template_division_lock();
