-- ===========================================================
-- ORVESEN QUESTION LIBRARY
-- ===========================================================

create table if not exists score_library_categories (

    id uuid primary key default gen_random_uuid(),

    division_id uuid references divisions(id) on delete cascade,

    name text not null,

    description text,

    position integer default 0,

    is_official boolean default true,

    created_at timestamptz default now(),

    updated_at timestamptz default now()

);

create table if not exists score_library_questions (

    id uuid primary key default gen_random_uuid(),

    category_id uuid references score_library_categories(id) on delete cascade,

    title text not null,

    description text,

    response_type text default 'yes_no',

    recommended_weight numeric default 0,

    difficulty text default 'medium',

    priority text default 'medium',

    score_value numeric default 100,

    recommendation text,

    playbook_id uuid,

    sop_id uuid,

    video_url text,

    options jsonb default '[]',

    tags jsonb default '[]',

    active boolean default true,

    created_at timestamptz default now(),

    updated_at timestamptz default now()

);

create index if not exists idx_question_category
on score_library_questions(category_id);

create index if not exists idx_question_title
on score_library_questions(title);

create index if not exists idx_category_division
on score_library_categories(division_id);
