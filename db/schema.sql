-- ============================================================================
-- Personal Project Management Board — Supabase schema
-- Run this once in: Supabase dashboard -> SQL Editor -> New query -> Run
-- Safe to re-run; every statement is idempotent.
-- ============================================================================

-- ---------------------------------------------------------------- enums ----
do $$ begin
  create type task_status as enum ('backlog', 'todo', 'in_progress', 'blocked', 'done');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('low', 'medium', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status as enum ('active', 'on_hold', 'completed', 'archived');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- profiles ----
-- One row per signed-up user. Holds the address alerts are mailed to and the
-- per-user alert switches, so the GitHub Action knows who to email and why.
create table if not exists public.profiles (
  id                uuid primary key references auth.users on delete cascade,
  email             text not null,
  full_name         text,
  timezone          text not null default 'UTC',
  daily_digest      boolean not null default true,
  weekly_summary    boolean not null default true,
  blocker_alerts    boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ------------------------------------------------------------- projects ----
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  name          text not null check (char_length(trim(name)) > 0),
  description   text,
  color         text not null default '#6366f1',
  status        project_status not null default 'active',
  due_date      date,
  sort_order    double precision not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists projects_user_idx on public.projects (user_id, sort_order);

-- ---------------------------------------------------------------- tasks ----
create table if not exists public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users on delete cascade,
  project_id          uuid not null references public.projects on delete cascade,
  title               text not null check (char_length(trim(title)) > 0),
  description         text,
  status              task_status not null default 'todo',
  priority            task_priority not null default 'medium',
  due_date            date,
  sort_order          double precision not null default 0,

  -- blocker tracking: blocked_at is stamped by a trigger the moment a task
  -- enters 'blocked'; blocked_notified_at is stamped by the alert job once the
  -- email goes out, so each blocker is only ever mailed once.
  blocked_reason      text,
  blocked_at          timestamptz,
  blocked_notified_at timestamptz,

  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists tasks_user_idx     on public.tasks (user_id, status, sort_order);
create index if not exists tasks_project_idx  on public.tasks (project_id, status, sort_order);
create index if not exists tasks_due_idx      on public.tasks (user_id, due_date) where status <> 'done';
create index if not exists tasks_blocked_idx  on public.tasks (user_id) where status = 'blocked' and blocked_notified_at is null;

-- ------------------------------------------------------------- triggers ----
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- Stamps the lifecycle timestamps so the UI never has to remember to.
create or replace function public.tasks_lifecycle()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();

  if new.status = 'blocked' and coalesce(old.status, 'todo') <> 'blocked' then
    new.blocked_at := now();
    new.blocked_notified_at := null;   -- re-blocking re-arms the alert
  elsif new.status <> 'blocked' then
    new.blocked_at := null;
    new.blocked_notified_at := null;
  end if;

  if new.status = 'done' and coalesce(old.status, 'todo') <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;

  return new;
end $$;

drop trigger if exists tasks_lifecycle_ins on public.tasks;
create trigger tasks_lifecycle_ins before insert on public.tasks
  for each row execute function public.tasks_lifecycle();

drop trigger if exists tasks_lifecycle_upd on public.tasks;
create trigger tasks_lifecycle_upd before update on public.tasks
  for each row execute function public.tasks_lifecycle();

-- Every new signup automatically gets a profile row.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------- row level security ----
-- Every policy is "the row belongs to me". Nobody can read anyone else's board.
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks    enable row level security;

drop policy if exists "own profile"  on public.profiles;
create policy "own profile"  on public.profiles for all
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own tasks"    on public.tasks;
create policy "own tasks"    on public.tasks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Backfill profiles for any user that signed up before this script ran.
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- ------------------------------------------------------------- realtime ----
-- Lets an open board update itself when you change something on another device.
-- Wrapped because the table may already be in the publication.
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.projects;
exception when duplicate_object then null; end $$;
