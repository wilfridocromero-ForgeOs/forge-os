-- Repair the one published frequency question created as multiple_choice with
-- an empty options array. The guards keep this idempotent and prevent changing
-- a question that was renamed, retyped or configured manually in the meantime.
update public.discovery_questions
set options = '["Semanal", "Quincenal", "Mensual", "Trimestral", "No se revisa"]'::jsonb,
    updated_at = now()
where id = '03f97705-1892-4095-a46a-7b33535fbd69'::uuid
  and prompt = '¿Con qué frecuencia revisas formalmente las métricas y resultados de ventas de tu negocio?'
  and response_type = 'multiple_choice'
  and jsonb_typeof(options) = 'array'
  and jsonb_array_length(options) = 0
  and exists (
    select 1
    from public.discovery_sections section
    join public.discovery_templates template on template.id = section.template_id
    where section.id = public.discovery_questions.section_id
      and template.status = 'published'
  );
