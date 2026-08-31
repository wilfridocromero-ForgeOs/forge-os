-- Keep Builder read policies singular; preserve the same founder/admin writes.
drop policy growth_system_revisions_manage on public.growth_system_revisions;
create policy growth_system_revisions_insert on public.growth_system_revisions for insert to authenticated
with check ((select public.can_manage_organization(organization_id)) and organization_id=(select public.current_user_organization_id()) and created_by=(select auth.uid()) and state='draft');
create policy growth_system_revisions_update on public.growth_system_revisions for update to authenticated
using ((select public.can_manage_organization(organization_id)) and state='draft')
with check ((select public.can_manage_organization(organization_id)) and organization_id=(select public.current_user_organization_id()) and state='draft');
create policy growth_system_revisions_delete on public.growth_system_revisions for delete to authenticated
using ((select public.can_manage_organization(organization_id)) and state='draft');

drop policy growth_system_nodes_manage on public.growth_system_nodes;
create policy growth_system_nodes_insert on public.growth_system_nodes for insert to authenticated
with check ((select public.can_manage_organization(organization_id)) and organization_id=(select public.current_user_organization_id()) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.system_id=system_id and r.organization_id=organization_id and r.state='draft'));
create policy growth_system_nodes_update on public.growth_system_nodes for update to authenticated
using ((select public.can_manage_organization(organization_id)) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.organization_id=organization_id and r.state='draft'))
with check ((select public.can_manage_organization(organization_id)) and organization_id=(select public.current_user_organization_id()) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.system_id=system_id and r.organization_id=organization_id and r.state='draft'));
create policy growth_system_nodes_delete on public.growth_system_nodes for delete to authenticated
using ((select public.can_manage_organization(organization_id)) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.organization_id=organization_id and r.state='draft'));

drop policy growth_system_edges_manage on public.growth_system_edges;
create policy growth_system_edges_insert on public.growth_system_edges for insert to authenticated
with check ((select public.can_manage_organization(organization_id)) and organization_id=(select public.current_user_organization_id()) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.system_id=system_id and r.organization_id=organization_id and r.state='draft'));
create policy growth_system_edges_update on public.growth_system_edges for update to authenticated
using ((select public.can_manage_organization(organization_id)) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.organization_id=organization_id and r.state='draft'))
with check ((select public.can_manage_organization(organization_id)) and organization_id=(select public.current_user_organization_id()) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.system_id=system_id and r.organization_id=organization_id and r.state='draft'));
create policy growth_system_edges_delete on public.growth_system_edges for delete to authenticated
using ((select public.can_manage_organization(organization_id)) and exists (select 1 from public.growth_system_revisions r where r.id=revision_id and r.organization_id=organization_id and r.state='draft'));
