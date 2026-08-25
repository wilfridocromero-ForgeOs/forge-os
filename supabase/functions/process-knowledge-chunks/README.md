# Knowledge document chunking

Authenticated organization managers may submit one or two explicit
`knowledge_document_versions` IDs. Only versions whose extraction is already
`completed` can be claimed. The request returns `202` and processing continues
through `EdgeRuntime.waitUntil`.

The worker uses deterministic hierarchical chunking with the versioned lexical
tokenizer `orvesen-lexical-v1`: target 450 tokens, maximum 800, and up to 60
tokens of overlap only inside the same inferred section. Headings are recorded
only when the normalized text contains explicit Markdown, numbered-outline, or
all-uppercase heading signals.

The caller JWT is used only for authorization. Claims and atomic persistence use
the server-side Supabase secret through service-role-only RPCs. The worker does
not read Storage, create embeddings, enable pgvector, or enqueue a backfill.

For the first production smoke, submit the certified TXT version only. Submit
the certified DOCX version in a separate request after the TXT result has been
reviewed. No automatic trigger is configured.
