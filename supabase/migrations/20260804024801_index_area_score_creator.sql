-- Exact historical SQL recovered read-only from
-- supabase_migrations.schema_migrations (20260804024801 / index_area_score_creator).
-- The migration is already applied remotely. Do not execute it manually
-- against production; this copy is for local history reconciliation only.

create index if not exists area_scores_created_by_idx on public.area_scores (created_by);
