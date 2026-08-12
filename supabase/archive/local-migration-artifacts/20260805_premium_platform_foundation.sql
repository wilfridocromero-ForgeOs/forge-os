-- ORVESEN OS premium foundation: automatic projects, score libraries and secure knowledge hierarchy.

-- PROJECTS: progress is derived exclusively from real operational items.
alter table public.project_tasks
  add column if not exists work_type text not null default 'task';

do $$ begin
  alter table public.project_tasks add constraint project_tasks_work_type_check
    check (work_type in ('task', 'checklist', 'milestone', 'review'));
exception when duplicate_object then null; end $$;

create schema if not exists private;

create or replace function private.recalculate_project_progress(target_project_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_items integer;
  completed_items integer;
  calculated numeric;
begin
  select count(*), count(*) filter (where completed)
  into total_items, completed_items
  from (
    select status = 'completed' as completed
    from public.project_tasks
    where project_id = target_project_id and status <> 'cancelled'
    union all
    select status in ('approved', 'delivered') as completed
    from public.project_deliverables
    where project_id = target_project_id and status <> 'rejected'
  ) items;

  calculated := case
    when total_items = 0 then 0
    else round((completed_items::numeric / total_items::numeric) * 100, 2)
  end;

  update public.projects
  set progress = calculated,
      updated_at = now()
  where id = target_project_id
    and progress is distinct from calculated;

  return calculated;
end;
$$;

create or replace function private.handle_project_progress_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recalculate_project_progress(coalesce(new.project_id, old.project_id));
  if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    perform private.recalculate_project_progress(old.project_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists project_tasks_progress_trigger on public.project_tasks;
create trigger project_tasks_progress_trigger
after insert or update or delete on public.project_tasks
for each row execute function private.handle_project_progress_change();

drop trigger if exists project_deliverables_progress_trigger on public.project_deliverables;
create trigger project_deliverables_progress_trigger
after insert or update or delete on public.project_deliverables
for each row execute function private.handle_project_progress_change();

revoke all on function private.recalculate_project_progress(uuid) from public, anon, authenticated;
revoke all on function private.handle_project_progress_change() from public, anon, authenticated;

do $$
declare project_row record;
begin
  for project_row in select id from public.projects loop
    perform private.recalculate_project_progress(project_row.id);
  end loop;
end $$;

-- A score and a reusable template share the same mature definition model.
alter table public.score_templates
  add column if not exists template_kind text not null default 'score',
  add column if not exists source_template_id uuid references public.score_templates(id) on delete set null;

do $$ begin
  alter table public.score_templates add constraint score_templates_kind_check
    check (template_kind in ('score', 'template'));
exception when duplicate_object then null; end $$;

create index if not exists score_templates_kind_idx
  on public.score_templates(organization_id, template_kind, updated_at desc);

-- SCORE LIBRARY: official reusable knowledge, independent from individual score configurations.
create table if not exists public.score_library_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  division_id uuid references public.divisions(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 100),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null default '',
  position integer not null default 0,
  is_official boolean not null default false,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (organization_id, division_id, slug)
);

create table if not exists public.score_library_questions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.score_library_categories(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 5 and 180),
  description text not null default '',
  recommended_weight numeric not null default 5 check (recommended_weight > 0 and recommended_weight <= 100),
  difficulty text not null default 'intermediate' check (difficulty in ('basic', 'intermediate', 'advanced')),
  response_type text not null default 'scale' check (response_type in ('scale', 'boolean', 'number', 'percentage', 'text', 'multiple_choice')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, title)
);

create table if not exists public.score_template_favorites (
  user_id uuid not null references public.users(id) on delete cascade,
  template_id uuid not null references public.score_templates(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, template_id)
);

alter table public.score_questions
  add column if not exists library_question_id uuid references public.score_library_questions(id) on delete set null;

create index if not exists score_library_categories_division_idx on public.score_library_categories(division_id, position);
create index if not exists score_library_questions_category_idx on public.score_library_questions(category_id, active);
create index if not exists score_questions_library_idx on public.score_questions(library_question_id);

alter table public.score_library_categories enable row level security;
alter table public.score_library_questions enable row level security;
alter table public.score_template_favorites enable row level security;

grant select, insert, update, delete on public.score_library_categories, public.score_library_questions, public.score_template_favorites to authenticated;

create policy "Members read available score categories" on public.score_library_categories
for select to authenticated using (
  is_official or organization_id = (select public.current_user_organization_id())
);
create policy "Managers create score categories" on public.score_library_categories
for insert to authenticated with check (
  (is_official and (select public.is_platform_owner()))
  or (not is_official and organization_id = (select public.current_user_organization_id()) and public.can_manage_organization(organization_id))
);
create policy "Managers update score categories" on public.score_library_categories
for update to authenticated using (
  (is_official and (select public.is_platform_owner()))
  or (not is_official and public.can_manage_organization(organization_id))
) with check (
  (is_official and (select public.is_platform_owner()))
  or (not is_official and organization_id = (select public.current_user_organization_id()) and public.can_manage_organization(organization_id))
);
create policy "Managers delete score categories" on public.score_library_categories
for delete to authenticated using (
  (is_official and (select public.is_platform_owner()))
  or (not is_official and public.can_manage_organization(organization_id))
);

create policy "Members read available score questions" on public.score_library_questions
for select to authenticated using (exists (
  select 1 from public.score_library_categories c
  where c.id = category_id and (c.is_official or c.organization_id = (select public.current_user_organization_id()))
));
create policy "Managers create score questions" on public.score_library_questions
for insert to authenticated with check (exists (
  select 1 from public.score_library_categories c where c.id = category_id
  and ((c.is_official and (select public.is_platform_owner())) or public.can_manage_organization(c.organization_id))
));
create policy "Managers update score questions" on public.score_library_questions
for update to authenticated using (exists (
  select 1 from public.score_library_categories c where c.id = category_id
  and ((c.is_official and (select public.is_platform_owner())) or public.can_manage_organization(c.organization_id))
)) with check (exists (
  select 1 from public.score_library_categories c where c.id = category_id
  and ((c.is_official and (select public.is_platform_owner())) or public.can_manage_organization(c.organization_id))
));
create policy "Managers delete score questions" on public.score_library_questions
for delete to authenticated using (exists (
  select 1 from public.score_library_categories c where c.id = category_id
  and ((c.is_official and (select public.is_platform_owner())) or public.can_manage_organization(c.organization_id))
));

create policy "Users read their score favorites" on public.score_template_favorites
for select to authenticated using (user_id = (select auth.uid()));
create policy "Users create their score favorites" on public.score_template_favorites
for insert to authenticated with check (user_id = (select auth.uid()) and exists (
  select 1 from public.score_templates t where t.id = template_id and t.organization_id = (select public.current_user_organization_id())
));
create policy "Users delete their score favorites" on public.score_template_favorites
for delete to authenticated using (user_id = (select auth.uid()));

-- Seed the first official ORVESEN Digital library: 15 categories x 15 professional assessment questions.
with digital as (
  select d.id division_id from public.divisions d
  join public.organizations o on o.id = d.organization_id
  where lower(d.name) = lower('ORVESEN Digital') and o.organization_type = 'internal'
  order by d.created_at limit 1
), category_seed(name, slug, description, position) as (
  values
  ('GestiÃ³n de Proyectos','gestion-de-proyectos','Gobernanza, alcance, planificaciÃ³n y control de proyectos digitales.',1),
  ('Calidad del Trabajo','calidad-del-trabajo','EstÃ¡ndares de calidad, revisiÃ³n y consistencia de entregables.',2),
  ('DiseÃ±o UI/UX','diseno-ui-ux','Experiencia, interfaz, usabilidad y decisiones centradas en usuarios.',3),
  ('Desarrollo Web','desarrollo-web','Arquitectura, mantenibilidad, seguridad y calidad de implementaciÃ³n.',4),
  ('Landing Pages','landing-pages','Claridad de propuesta, conversiÃ³n y calidad tÃ©cnica de pÃ¡ginas de campaÃ±a.',5),
  ('SEO','seo','Visibilidad orgÃ¡nica, rastreabilidad, contenido y salud tÃ©cnica.',6),
  ('Responsive','responsive','Adaptabilidad, legibilidad y operaciÃ³n consistente entre dispositivos.',7),
  ('Performance','performance','Velocidad, estabilidad visual, eficiencia y experiencia percibida.',8),
  ('Automatizaciones','automatizaciones','Fiabilidad, trazabilidad y valor operativo de automatizaciones.',9),
  ('Branding','branding','Coherencia, diferenciaciÃ³n y aplicaciÃ³n sistemÃ¡tica de marca.',10),
  ('ComunicaciÃ³n','comunicacion','Claridad, cadencia, documentaciÃ³n y alineaciÃ³n con interesados.',11),
  ('Productividad','productividad','Flujo, foco, capacidad, priorizaciÃ³n y eliminaciÃ³n de bloqueos.',12),
  ('DocumentaciÃ³n','documentacion','Calidad, vigencia, accesibilidad y uso del conocimiento documentado.',13),
  ('Cumplimiento de Procesos','cumplimiento-de-procesos','Adherencia, control, evidencia y mejora continua de procesos.',14),
  ('InnovaciÃ³n','innovacion','ExperimentaciÃ³n, aprendizaje y conversiÃ³n de ideas en valor medible.',15)
)
insert into public.score_library_categories(division_id,name,slug,description,position,is_official)
select digital.division_id,s.name,s.slug,s.description,s.position,true from digital cross join category_seed s
on conflict (organization_id,division_id,slug) do update set name=excluded.name,description=excluded.description,position=excluded.position,is_official=true;

with dimension_seed(position, title_pattern, description_pattern, weight, difficulty, response_type) as (
  values
  (1,'EstÃ¡ndar definido para %s','EvalÃºa si existen criterios documentados, responsables y un resultado esperado verificable para %s.',8,'basic','boolean'),
  (2,'Madurez actual de %s','Valora de 1 a 5 el nivel de consistencia, repetibilidad y control demostrado en %s.',8,'intermediate','scale'),
  (3,'Cobertura medible de %s','Indica el porcentaje de trabajo relevante que actualmente cumple los estÃ¡ndares acordados de %s.',8,'intermediate','percentage'),
  (4,'Responsabilidad operativa en %s','Confirma si existe una persona responsable, con autoridad y seguimiento periÃ³dico sobre %s.',6,'basic','boolean'),
  (5,'Calidad de la evidencia en %s','Valora la calidad de mÃ©tricas, registros y pruebas disponibles para demostrar resultados en %s.',8,'advanced','scale'),
  (6,'Frecuencia de revisiÃ³n de %s','Describe cada cuÃ¡nto se revisan resultados, riesgos y oportunidades relacionados con %s.',5,'intermediate','multiple_choice'),
  (7,'Incidencias abiertas en %s','Registra la cantidad actual de incidencias relevantes que afectan el desempeÃ±o de %s.',6,'intermediate','number'),
  (8,'Riesgo operativo de %s','Valora de 1 a 5 el impacto y probabilidad de fallos no controlados dentro de %s.',7,'advanced','scale'),
  (9,'AutomatizaciÃ³n aplicada a %s','Indica quÃ© porcentaje del flujo repetitivo de %s estÃ¡ automatizado con controles confiables.',6,'advanced','percentage'),
  (10,'SatisfacciÃ³n de interesados en %s','Valora de 1 a 5 la satisfacciÃ³n de clientes, usuarios y responsables respecto a %s.',7,'intermediate','scale'),
  (11,'Cumplimiento de plazos en %s','Indica el porcentaje de compromisos de %s entregados dentro del plazo acordado.',8,'intermediate','percentage'),
  (12,'Dependencias crÃ­ticas de %s','Documenta las dependencias externas o internas que podrÃ­an comprometer los resultados de %s.',5,'advanced','text'),
  (13,'Plan de mejora para %s','Confirma si existe un plan priorizado, con responsables y fechas, para mejorar %s.',6,'intermediate','boolean'),
  (14,'Impacto empresarial de %s','Valora de 1 a 5 cuÃ¡nto contribuye actualmente %s a los objetivos estratÃ©gicos y financieros.',7,'advanced','scale'),
  (15,'PrÃ³xima decisiÃ³n sobre %s','Describe la decisiÃ³n concreta mÃ¡s importante que debe tomarse para elevar el desempeÃ±o de %s.',5,'advanced','text')
), official_categories as (
  select c.id,c.name from public.score_library_categories c where c.is_official
  and c.division_id in (select d.id from public.divisions d where lower(d.name)=lower('ORVESEN Digital'))
)
insert into public.score_library_questions(category_id,title,description,recommended_weight,difficulty,response_type,options)
select c.id,format(d.title_pattern,c.name),format(d.description_pattern,c.name),d.weight,d.difficulty,d.response_type,
  case when d.response_type='multiple_choice' then '["Semanal","Quincenal","Mensual","Trimestral","No se revisa"]'::jsonb else '[]'::jsonb end
from official_categories c cross join dimension_seed d
on conflict (category_id,title) do update set description=excluded.description,recommended_weight=excluded.recommended_weight,difficulty=excluded.difficulty,response_type=excluded.response_type,options=excluded.options,active=true;

-- KNOWLEDGE: members read; only organization managers mutate folders.
drop policy if exists "Organization members manage knowledge folders" on public.knowledge_folders;
create policy "Organization members read knowledge folders" on public.knowledge_folders
for select to authenticated using (organization_id = (select public.current_user_organization_id()));
create policy "Organization managers create knowledge folders" on public.knowledge_folders
for insert to authenticated with check (
  organization_id = (select public.current_user_organization_id())
  and created_by = (select auth.uid())
  and public.can_manage_organization(organization_id)
  and (parent_id is null or exists (select 1 from public.knowledge_folders p where p.id=parent_id and p.organization_id=knowledge_folders.organization_id))
);
create policy "Organization managers update knowledge folders" on public.knowledge_folders
for update to authenticated using (public.can_manage_organization(organization_id))
with check (
  organization_id = (select public.current_user_organization_id())
  and public.can_manage_organization(organization_id)
  and parent_id is distinct from id
  and (parent_id is null or exists (select 1 from public.knowledge_folders p where p.id=parent_id and p.organization_id=knowledge_folders.organization_id))
);
create policy "Organization managers delete knowledge folders" on public.knowledge_folders
for delete to authenticated using (public.can_manage_organization(organization_id));

create index if not exists knowledge_folders_parent_idx on public.knowledge_folders(organization_id,parent_id,name);

-- Keep timestamps consistent.
drop trigger if exists set_score_library_categories_updated_at on public.score_library_categories;
create trigger set_score_library_categories_updated_at before update on public.score_library_categories
for each row execute function public.set_updated_at();
drop trigger if exists set_score_library_questions_updated_at on public.score_library_questions;
create trigger set_score_library_questions_updated_at before update on public.score_library_questions
for each row execute function public.set_updated_at();

