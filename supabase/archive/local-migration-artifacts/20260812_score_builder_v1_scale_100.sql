-- Score Builder V1 creates functional division/area evaluations on a 0-100 scale.
-- The future organization master score (0-1000) is intentionally outside this model.

alter table public.score_templates
  drop constraint if exists score_templates_max_score_check;

update public.score_templates
set max_score = 100,
    updated_at = now()
where max_score is distinct from 100;

alter table public.score_templates
  alter column max_score set default 100;

alter table public.score_templates
  add constraint score_templates_max_score_check check (max_score = 100);

update public.score_instances
set current_score = round(percentage, 2),
    max_score = 100,
    updated_at = now()
where max_score is distinct from 100
   or current_score is distinct from round(percentage, 2);

alter table public.score_instances
  alter column max_score set default 100;

