# Artefactos históricos de migraciones locales

Esta carpeta conserva archivos SQL históricos de ORVESEN que no corresponden
exactamente a versiones registradas en
`supabase_migrations.schema_migrations`.

Se retiraron de `supabase/migrations` para evitar que Supabase CLI los
interprete como migraciones adicionales y trate de ejecutarlos accidentalmente.

Las versiones oficiales exactas recuperadas desde el historial remoto viven en
`supabase/migrations` con sus timestamps completos.

Estos archivos se conservan únicamente como referencia histórica. No deben
ejecutarse manualmente contra producción.
