-- Recovered historical artifact for remote migration 20260805231035.
-- Its indexes were verified against the current remote PostgreSQL catalogs.
-- This file is prepared only to reconcile local version control. The objects
-- already exist remotely; do not execute it manually against production.

-- Cover foreign keys introduced or exercised by the premium foundation.
create index if not exists score_template_favorites_template_idx on public.score_template_favorites(template_id);
create index if not exists score_templates_source_template_idx on public.score_templates(source_template_id) where source_template_id is not null;
create index if not exists score_metrics_category_idx on public.score_metrics(category_id);
create index if not exists score_metric_values_metric_idx on public.score_metric_values(metric_id);
create index if not exists knowledge_documents_folder_idx on public.knowledge_documents(folder_id) where folder_id is not null;
create index if not exists knowledge_documents_division_idx on public.knowledge_documents(division_id) where division_id is not null;
create index if not exists knowledge_documents_uploaded_by_idx on public.knowledge_documents(uploaded_by);
create index if not exists knowledge_folders_created_by_idx on public.knowledge_folders(created_by);
create index if not exists knowledge_folders_division_idx on public.knowledge_folders(division_id) where division_id is not null;
