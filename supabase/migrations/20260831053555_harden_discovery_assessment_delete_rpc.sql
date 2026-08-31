-- Keep the privileged implementation outside the exposed API schema. The
-- public RPC remains a narrow SECURITY INVOKER gateway and cannot be used by
-- anonymous callers.

alter function public.delete_in_progress_discovery_assessment(uuid)
  set schema private;

alter function private.delete_in_progress_discovery_assessment(uuid) owner to postgres;
revoke all on function private.delete_in_progress_discovery_assessment(uuid)
  from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.delete_in_progress_discovery_assessment(uuid)
  to authenticated;

create function public.delete_in_progress_discovery_assessment(
  target_assessment_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.delete_in_progress_discovery_assessment(target_assessment_id);
$$;

alter function public.delete_in_progress_discovery_assessment(uuid) owner to postgres;
revoke all on function public.delete_in_progress_discovery_assessment(uuid)
  from public, anon;
grant execute on function public.delete_in_progress_discovery_assessment(uuid)
  to authenticated;
