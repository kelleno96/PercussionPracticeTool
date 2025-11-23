-- Supabase/Postgres schema for stroke counter

create extension if not exists "uuid-ossp";

-- Users
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  safe_display_name text,
  safe_username text generated always as (regexp_replace(lower(display_name), '[^a-z0-9]+', '-', 'g')) stored,
  photo_url text,
  created_at timestamptz default now()
);

-- Exercises
create table if not exists public.exercises (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade,
  name text not null,
  goal_per_day int,
  created_at timestamptz default now()
);
create index if not exists exercises_user_id_idx on public.exercises(user_id);

-- Sessions
create table if not exists public.sessions (
  id uuid primary key,
  user_id uuid references auth.users on delete cascade,
  exercise_id uuid references public.exercises,
  exercise_name text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  tempo int,
  subdivision int,
  created_at timestamptz default now()
);
create index if not exists sessions_user_idx on public.sessions(user_id);
create index if not exists sessions_exercise_idx on public.sessions(exercise_id);

-- Strokes
create table if not exists public.strokes (
  id uuid primary key,
  session_id uuid references public.sessions on delete cascade,
  exercise_id uuid references public.exercises,
  user_id uuid references auth.users on delete cascade,
  at timestamptz not null,
  db double precision,
  rms double precision,
  threshold_db double precision,
  floor_db double precision
);
create index if not exists strokes_session_idx on public.strokes(session_id);
create index if not exists strokes_at_idx on public.strokes(at);
create index if not exists strokes_exercise_idx on public.strokes(exercise_id);

-- Materialized/paginated leaderboards
create table if not exists public.leaderboard_cache (
  id uuid primary key default uuid_generate_v4(),
  category text not null, -- e.g., lifetime, weekly, streak, per-exercise
  period_start timestamptz,
  period_end timestamptz,
  payload jsonb not null, -- rows with {user_id, display_name, value, rank, exercise_id?}
  generated_at timestamptz default now()
);
create index if not exists leaderboard_category_idx on public.leaderboard_cache(category, period_start, period_end);

-- Convenience view for frontend fetch
create or replace view public.sessions_view as
select s.*, coalesce(json_agg(st.* order by st.at) filter (where st.id is not null), '[]') as strokes
from public.sessions s
left join public.strokes st on st.session_id = s.id
group by s.id;

-- RLS
alter table public.exercises enable row level security;
alter table public.sessions enable row level security;
alter table public.strokes enable row level security;
alter table public.leaderboard_cache enable row level security;
alter table public.profiles enable row level security;

create policy "Users can see own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);

create policy "Exercises are per-user" on public.exercises
  for all using (auth.uid() = user_id);

create policy "Sessions are per-user" on public.sessions
  for all using (auth.uid() = user_id);

create policy "Strokes are per-user" on public.strokes
  for all using (auth.uid() = user_id);

create policy "Leaderboards readable" on public.leaderboard_cache
  for select using (true); -- public-safe usernames only

-- Suggested Edge Function (not included here): compute leaderboards with rate limits,
-- validate batches, and insert into leaderboard_cache. Apply rate limiting at API edge.
