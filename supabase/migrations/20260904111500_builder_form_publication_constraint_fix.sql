-- ORVESEN Builder hotfix: allow FormDocumentV1 in builder_asset_drafts.
-- Existing publication metadata validation is landing-page specific and rejected form drafts.

alter table public.builder_asset_drafts
  drop constraint if exists builder_asset_drafts_publication_metadata_check;

alter table public.builder_asset_drafts
  add constraint builder_asset_drafts_publication_metadata_check
  check (
    (document->>'document_type' = 'form' and private.builder_form_document_v1_is_valid(document))
    or
    (document->>'document_type' = 'landing_page' and private.builder_landing_publication_metadata_v1_is_valid(document))
  );
