# Knowledge document extraction

Authenticated organization managers may enqueue between one and five explicit
`knowledge_document_versions` IDs. The request returns `202` immediately and
processing continues through `EdgeRuntime.waitUntil`.

Supported in V1: DOCX, TXT, CSV, and JSON. The worker calculates SHA-256 before
parsing and reuses completed text only when the checksum belongs to the same
organization.

The Edge Function uses the caller JWT only for authorization. Storage download
and extraction state updates use the server-side Supabase secret; it is never
returned to or accepted from the browser.

There is intentionally no automatic production backfill. Existing pending
versions can later be submitted in controlled batches of at most five IDs.
