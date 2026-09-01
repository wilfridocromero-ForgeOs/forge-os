-- Builder Phase 2: Supabase default table privileges include operations that
-- are not part of the Assets Foundation contract. Revoke them explicitly
-- before restoring the minimum authenticated surface.

revoke all on public.builder_assets from authenticated;
revoke all on public.builder_asset_versions from authenticated;

grant select, insert, update on public.builder_assets to authenticated;
grant select, insert on public.builder_asset_versions to authenticated;
