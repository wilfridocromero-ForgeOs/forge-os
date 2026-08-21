# ORVESEN Web Push delivery

This Edge Function is prepared locally for a Supabase Database Webhook on
`public.notifications` / `INSERT`. It is intentionally not deployed or connected
as part of the local 8B implementation.

Required Edge Function secrets:

- `PUSH_WEBHOOK_SECRET`: high-entropy shared secret sent only by the Database Webhook as `x-orvesen-push-secret`.
- `VAPID_SUBJECT`: `mailto:` or HTTPS VAPID contact.
- `VAPID_PUBLIC_KEY`: public VAPID key, matching `VITE_VAPID_PUBLIC_KEY` in Vercel.
- `VAPID_PRIVATE_KEY`: private VAPID key; Edge Function secret only.
- Supabase-provided `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` (or legacy `SUPABASE_SERVICE_ROLE_KEY`).

When deployment is later authorized, configure the function without gateway JWT
verification because the Database Webhook is not an end-user JWT request. The
function performs its own strict `PUSH_WEBHOOK_SECRET` verification and accepts
only `INSERT` payloads for `public.notifications`. Do not expose this secret to
React, Vercel public variables, or the repository.

The Database Webhook must be configured only after the migration and function are
deployed. It must send the shared secret header and must not be callable from the
browser. No cron, Realtime, or SQL HTTP trigger is required.
