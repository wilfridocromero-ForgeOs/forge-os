revoke all on table public.task_evidence_requirements from public, anon, authenticated;
revoke all on table public.task_evidence from public, anon, authenticated;

grant select, insert, update, delete on table public.task_evidence_requirements to authenticated;
grant select, insert, update on table public.task_evidence to authenticated;
