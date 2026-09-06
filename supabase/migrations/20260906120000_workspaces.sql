-- ============================================================================
-- v2: workspaces, teams, role-based access, and the approval gate
--
-- Replaces the single-owner model ("auth.uid() = user_id") with membership:
-- a row is visible because you belong to the team / workspace that owns it.
-- Your Personal workspace stays private under exactly the same rule — you are
-- simply its only member.
-- ============================================================================

-- ---------------------------------------------------------------- enums ----
do $$ begin create type workspace_kind as enum ('personal','hackathon','program','team'); exception when duplicate_object then null; end $$;
do $$ begin create type workspace_role as enum ('owner','admin','manager','judge','member'); exception when duplicate_object then null; end $$;
do $$ begin create type team_role      as enum ('lead','member'); exception when duplicate_object then null; end $$;
do $$ begin create type member_status  as enum ('pending','active','suspended','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type request_status as enum ('pending','approved','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type milestone_kind as enum ('registration','build','submission','judging','demo','custom'); exception when duplicate_object then null; end $$;
do $$ begin create type meeting_status as enum ('scheduled','completed','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type rsvp_status    as enum ('pending','accepted','declined'); exception when duplicate_object then null; end $$;
do $$ begin create type attachment_kind as enum ('doc','design','repo','video','sheet','other'); exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- profiles ----
alter table public.profiles add column if not exists gender          text;
alter table public.profiles add column if not exists phone           text;
alter table public.profiles add column if not exists organization    text;
alter table public.profiles add column if not exists role_title      text;
alter table public.profiles add column if not exists github_url      text;
alter table public.profiles add column if not exists linkedin_url    text;
alter table public.profiles add column if not exists country         text;
alter table public.profiles add column if not exists bio             text;
alter table public.profiles add column if not exists status          member_status not null default 'pending';
alter table public.profiles add column if not exists is_super_admin  boolean not null default false;
alter table public.profiles add column if not exists mention_alerts  boolean not null default true;
alter table public.profiles add column if not exists meeting_alerts  boolean not null default true;

-- ----------------------------------------------------------- workspaces ----
create table if not exists public.workspaces (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(trim(name)) > 0),
  slug              text not null unique,
  kind              workspace_kind not null default 'program',
  description       text,
  color             text not null default '#6366f1',
  emoji             text not null default '🗂️',
  owner_id          uuid not null references auth.users on delete cascade,

  -- A cohort can self-onboard with a code instead of queueing for approval.
  join_code         text unique,
  join_code_enabled boolean not null default false,
  join_role         workspace_role not null default 'member',

  starts_at         timestamptz,
  ends_at           timestamptz,
  is_archived       boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         workspace_role not null default 'member',
  invited_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index if not exists ws_members_user_idx on public.workspace_members (user_id);

-- ---------------------------------------------------------------- teams ----
create table if not exists public.teams (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name         text not null check (char_length(trim(name)) > 0),
  description  text,
  color        text not null default '#0ea5e9',
  emoji        text not null default '🚀',
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists teams_ws_idx on public.teams (workspace_id);

create table if not exists public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  role       team_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (team_id, user_id)
);
create index if not exists team_members_user_idx on public.team_members (user_id);

-- --------------------------------------------- projects / tasks upgrade ----
alter table public.projects add column if not exists workspace_id uuid references public.workspaces on delete cascade;
alter table public.projects add column if not exists team_id      uuid references public.teams on delete set null;
alter table public.projects add column if not exists created_by   uuid references auth.users on delete set null;
alter table public.projects add column if not exists repo_url     text;
alter table public.projects add column if not exists demo_url     text;
alter table public.projects add column if not exists video_url    text;
alter table public.projects add column if not exists doc_url      text;
alter table public.projects add column if not exists submitted_at timestamptz;

alter table public.tasks add column if not exists assignee_id uuid references auth.users on delete set null;
alter table public.tasks add column if not exists created_by  uuid references auth.users on delete set null;

create index if not exists projects_ws_idx   on public.projects (workspace_id);
create index if not exists projects_team_idx on public.projects (team_id);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id) where status <> 'done';

-- ------------------------------------------------------------ backfill ----
-- Everything that exists today belongs to its owner's Personal workspace.
do $$
declare u record; ws uuid;
begin
  for u in select distinct user_id from public.projects where workspace_id is null loop
    insert into public.workspaces (name, slug, kind, description, emoji, owner_id)
    values ('Personal', 'personal-' || left(replace(u.user_id::text,'-',''), 12), 'personal',
            'Your private workspace. Only you can see it.', '🏠', u.user_id)
    returning id into ws;

    insert into public.workspace_members (workspace_id, user_id, role) values (ws, u.user_id, 'owner');
    update public.projects set workspace_id = ws, created_by = user_id
      where user_id = u.user_id and workspace_id is null;
  end loop;
end $$;

update public.tasks set created_by = user_id where created_by is null;

-- The first account on the instance becomes the super admin and is auto-active.
update public.profiles p set is_super_admin = true, status = 'active'
where p.id = (select id from auth.users order by created_at limit 1);

-- Anyone who already had data predates the gate, so let them keep working.
update public.profiles set status = 'active'
where status = 'pending' and id in (select distinct user_id from public.projects);

-- ------------------------------------------------------------ requests ----
create table if not exists public.access_requests (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references auth.users on delete cascade,
  email                 text not null,
  full_name             text not null,
  gender                text,
  phone                 text,
  organization          text,
  role_title            text,
  github_url            text,
  country               text,
  motivation            text,
  requested_workspace_id uuid references public.workspaces on delete set null,
  status                request_status not null default 'pending',
  reviewed_by           uuid references auth.users on delete set null,
  reviewed_at           timestamptz,
  decision_note         text,
  admin_notified_at     timestamptz,
  user_notified_at      timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists requests_pending_idx on public.access_requests (status, created_at);

-- ---------------------------------------------------------- milestones ----
create table if not exists public.milestones (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name         text not null,
  description  text,
  kind         milestone_kind not null default 'custom',
  due_at       timestamptz not null,
  sort_order   double precision not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists milestones_ws_idx on public.milestones (workspace_id, due_at);

-- --------------------------------------------------------- attachments ----
create table if not exists public.attachments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects on delete cascade,
  task_id     uuid references public.tasks on delete cascade,
  label       text not null,
  url         text not null,
  kind        attachment_kind not null default 'doc',
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  check (project_id is not null or task_id is not null)
);
create index if not exists attachments_project_idx on public.attachments (project_id);
create index if not exists attachments_task_idx    on public.attachments (task_id);

-- --------------------------------------------- comments and @ mentions ----
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references public.tasks on delete cascade,
  project_id uuid references public.projects on delete cascade,
  author_id  uuid not null references auth.users on delete cascade,
  body       text not null check (char_length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (task_id is not null or project_id is not null)
);
create index if not exists comments_task_idx on public.comments (task_id, created_at);

create table if not exists public.mentions (
  id                uuid primary key default gen_random_uuid(),
  comment_id        uuid not null references public.comments on delete cascade,
  mentioned_user_id uuid not null references auth.users on delete cascade,
  notified_at       timestamptz,
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  unique (comment_id, mentioned_user_id)
);
create index if not exists mentions_pending_idx on public.mentions (mentioned_user_id) where notified_at is null;

-- ------------------------------------------------------------ meetings ----
create table if not exists public.meetings (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  team_id      uuid references public.teams on delete cascade,
  title        text not null,
  agenda       text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  location     text,
  meeting_url  text,
  provider     text not null default 'teams',
  status       meeting_status not null default 'scheduled',
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists meetings_ws_idx on public.meetings (workspace_id, starts_at);

create table if not exists public.meeting_attendees (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  response    rsvp_status not null default 'pending',
  notified_at timestamptz,
  unique (meeting_id, user_id)
);

-- ------------------------------------------------------------- judging ----
create table if not exists public.judging_criteria (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name         text not null,
  description  text,
  max_score    integer not null default 10 check (max_score between 1 and 100),
  weight       numeric not null default 1 check (weight > 0),
  sort_order   double precision not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.scores (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects on delete cascade,
  criterion_id uuid not null references public.judging_criteria on delete cascade,
  judge_id     uuid not null references auth.users on delete cascade,
  score        numeric not null check (score >= 0),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (project_id, criterion_id, judge_id)
);
create index if not exists scores_project_idx on public.scores (project_id);

-- ----------------------------------------------------------- audit log ----
create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users on delete set null,
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  workspace_id uuid references public.workspaces on delete cascade,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists audit_ws_idx on public.audit_log (workspace_id, created_at desc);

-- ============================================================================
-- Access helpers.
--
-- Every one is SECURITY DEFINER so a policy on workspace_members can ask
-- "am I a member?" without re-entering its own policy and recursing forever —
-- the classic Supabase RLS trap.
-- ============================================================================

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_super_admin and status = 'active');
$$;

create or replace function public.ws_role(ws uuid)
returns workspace_role language sql stable security definer set search_path = public as $$
  select role from workspace_members where workspace_id = ws and user_id = auth.uid();
$$;

create or replace function public.is_ws_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_super_admin() or (is_active() and exists (
    select 1 from workspace_members where workspace_id = ws and user_id = auth.uid()));
$$;

create or replace function public.is_ws_admin(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_super_admin() or (is_active() and exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid() and role in ('owner','admin')));
$$;

create or replace function public.is_ws_judge(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_super_admin() or (is_active() and exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid() and role in ('owner','admin','judge')));
$$;

create or replace function public.is_team_member(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_super_admin() or (is_active() and exists (
    select 1 from team_members where team_id = t and user_id = auth.uid()));
$$;

create or replace function public.is_team_lead(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_super_admin()
      or (is_active() and exists (
            select 1 from team_members where team_id = t and user_id = auth.uid() and role = 'lead'))
      or is_ws_admin((select workspace_id from teams where id = t));
$$;

-- A project is visible to workspace admins and judges, to the team that owns
-- it, and — when it has no team — to the whole workspace.
create or replace function public.can_view_project(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects pr
    where pr.id = p and (
         is_ws_judge(pr.workspace_id)
      or (pr.team_id is not null and is_team_member(pr.team_id))
      or (pr.team_id is null and is_ws_member(pr.workspace_id))
    ));
$$;

create or replace function public.can_edit_project(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects pr
    where pr.id = p and (
         is_ws_admin(pr.workspace_id)
      or (pr.team_id is not null and is_team_member(pr.team_id))
      or (pr.team_id is null and is_ws_member(pr.workspace_id))
    ));
$$;

create or replace function public.shares_workspace(other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_super_admin() or exists (
    select 1 from workspace_members a
    join workspace_members b on a.workspace_id = b.workspace_id
    where a.user_id = auth.uid() and b.user_id = other);
$$;

-- ---------------------------------------------------- join code redemption --
-- Runs as definer so an approved-but-unplaced user can look up a code they
-- could not otherwise select, and join in one hop.
create or replace function public.redeem_join_code(code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w record; uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;

  select * into w from workspaces
  where join_code_enabled and lower(join_code) = lower(trim(code)) and not is_archived;

  if not found then return jsonb_build_object('ok', false, 'error', 'That code is not valid.'); end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (w.id, uid, w.join_role) on conflict (workspace_id, user_id) do nothing;

  -- A valid code is itself the approval, so the account goes straight to active.
  update profiles set status = 'active' where id = uid and status in ('pending','rejected');

  insert into audit_log (actor_id, action, entity_type, entity_id, workspace_id, detail)
  values (uid, 'join_code_redeemed', 'workspace', w.id, w.id, jsonb_build_object('role', w.join_role));

  return jsonb_build_object('ok', true, 'workspace_id', w.id, 'name', w.name);
end $$;

-- ------------------------------------------------------ approve / reject --
create or replace function public.review_access_request(
  request_id uuid, decision text, ws uuid default null,
  assign_role workspace_role default 'member', team uuid default null, note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not is_super_admin() then return jsonb_build_object('ok', false, 'error', 'not authorised'); end if;

  select * into r from access_requests where id = request_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such request'); end if;

  if decision = 'approved' then
    update profiles set status = 'active' where id = r.user_id;
    if ws is not null then
      insert into workspace_members (workspace_id, user_id, role, invited_by)
      values (ws, r.user_id, assign_role, auth.uid())
      on conflict (workspace_id, user_id) do update set role = excluded.role;
    end if;
    if team is not null then
      insert into team_members (team_id, user_id) values (team, r.user_id)
      on conflict (team_id, user_id) do nothing;
    end if;
  else
    update profiles set status = 'rejected' where id = r.user_id;
  end if;

  update access_requests set
    status = decision::request_status, reviewed_by = auth.uid(), reviewed_at = now(),
    decision_note = note, user_notified_at = null
  where id = request_id;

  insert into audit_log (actor_id, action, entity_type, entity_id, workspace_id, detail)
  values (auth.uid(), 'access_' || decision, 'access_request', request_id, ws,
          jsonb_build_object('email', r.email, 'role', assign_role));

  return jsonb_build_object('ok', true);
end $$;

-- ============================================================================
-- Row level security
-- ============================================================================
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.teams             enable row level security;
alter table public.team_members      enable row level security;
alter table public.access_requests   enable row level security;
alter table public.milestones        enable row level security;
alter table public.attachments       enable row level security;
alter table public.comments          enable row level security;
alter table public.mentions          enable row level security;
alter table public.meetings          enable row level security;
alter table public.meeting_attendees enable row level security;
alter table public.judging_criteria  enable row level security;
alter table public.scores            enable row level security;
alter table public.audit_log         enable row level security;

-- profiles: yourself, anyone you share a workspace with, and the super admin.
drop policy if exists "own profile" on public.profiles;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or shares_workspace(id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or is_super_admin()) with check (id = auth.uid() or is_super_admin());

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces for select using (is_ws_member(id));
drop policy if exists workspaces_write on public.workspaces;
create policy workspaces_write on public.workspaces for all
  using (is_ws_admin(id)) with check (is_ws_admin(id) or owner_id = auth.uid());
drop policy if exists workspaces_insert on public.workspaces;
create policy workspaces_insert on public.workspaces for insert
  with check (is_super_admin() or owner_id = auth.uid());

drop policy if exists ws_members_select on public.workspace_members;
create policy ws_members_select on public.workspace_members for select
  using (user_id = auth.uid() or is_ws_member(workspace_id));
drop policy if exists ws_members_write on public.workspace_members;
create policy ws_members_write on public.workspace_members for all
  using (is_ws_admin(workspace_id)) with check (is_ws_admin(workspace_id));

drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select using (is_ws_member(workspace_id));
drop policy if exists teams_write on public.teams;
create policy teams_write on public.teams for all
  using (is_ws_admin(workspace_id) or is_team_lead(id))
  with check (is_ws_admin(workspace_id) or is_ws_member(workspace_id));

drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members for select
  using (user_id = auth.uid() or is_ws_member((select workspace_id from teams where id = team_id)));
drop policy if exists team_members_write on public.team_members;
create policy team_members_write on public.team_members for all
  using (is_team_lead(team_id)) with check (is_team_lead(team_id));

-- projects / tasks now hang off membership rather than ownership.
drop policy if exists "own projects" on public.projects;
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select using (can_view_project(id));
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert
  with check (is_ws_admin(workspace_id)
              or (team_id is not null and is_team_member(team_id))
              or (team_id is null and is_ws_member(workspace_id)));
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update
  using (can_edit_project(id)) with check (can_edit_project(id));
drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects for delete
  using (is_ws_admin(workspace_id) or (team_id is not null and is_team_lead(team_id)));

drop policy if exists "own tasks" on public.tasks;
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select using (can_view_project(project_id));
drop policy if exists tasks_write on public.tasks;
create policy tasks_write on public.tasks for all
  using (can_edit_project(project_id)) with check (can_edit_project(project_id));

-- Anyone signed in may file a request; only the super admin reviews them.
drop policy if exists requests_insert on public.access_requests;
create policy requests_insert on public.access_requests for insert
  with check (user_id = auth.uid() or auth.uid() is not null);
drop policy if exists requests_select on public.access_requests;
create policy requests_select on public.access_requests for select
  using (user_id = auth.uid() or is_super_admin());
drop policy if exists requests_update on public.access_requests;
create policy requests_update on public.access_requests for update
  using (is_super_admin()) with check (is_super_admin());

drop policy if exists milestones_select on public.milestones;
create policy milestones_select on public.milestones for select using (is_ws_member(workspace_id));
drop policy if exists milestones_write on public.milestones;
create policy milestones_write on public.milestones for all
  using (is_ws_admin(workspace_id)) with check (is_ws_admin(workspace_id));

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select
  using (can_view_project(coalesce(project_id, (select project_id from tasks where id = task_id))));
drop policy if exists attachments_write on public.attachments;
create policy attachments_write on public.attachments for all
  using (can_edit_project(coalesce(project_id, (select project_id from tasks where id = task_id))))
  with check (can_edit_project(coalesce(project_id, (select project_id from tasks where id = task_id))));

drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select
  using (can_view_project(coalesce(project_id, (select project_id from tasks where id = task_id))));
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert
  with check (author_id = auth.uid()
              and can_view_project(coalesce(project_id, (select project_id from tasks where id = task_id))));
drop policy if exists comments_modify on public.comments;
create policy comments_modify on public.comments for update using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete using (author_id = auth.uid());

drop policy if exists mentions_select on public.mentions;
create policy mentions_select on public.mentions for select
  using (mentioned_user_id = auth.uid()
         or exists (select 1 from comments c where c.id = comment_id and c.author_id = auth.uid()));
drop policy if exists mentions_insert on public.mentions;
create policy mentions_insert on public.mentions for insert
  with check (exists (select 1 from comments c where c.id = comment_id and c.author_id = auth.uid()));
drop policy if exists mentions_update on public.mentions;
create policy mentions_update on public.mentions for update
  using (mentioned_user_id = auth.uid()) with check (mentioned_user_id = auth.uid());

drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select
  using (is_ws_member(workspace_id) and (team_id is null or is_team_member(team_id) or is_ws_admin(workspace_id)));
drop policy if exists meetings_write on public.meetings;
create policy meetings_write on public.meetings for all
  using (is_ws_admin(workspace_id) or (team_id is not null and is_team_lead(team_id)) or created_by = auth.uid())
  with check (is_ws_member(workspace_id));

drop policy if exists attendees_select on public.meeting_attendees;
create policy attendees_select on public.meeting_attendees for select
  using (user_id = auth.uid()
         or is_ws_member((select workspace_id from meetings where id = meeting_id)));
drop policy if exists attendees_write on public.meeting_attendees;
create policy attendees_write on public.meeting_attendees for all
  using (user_id = auth.uid() or is_ws_admin((select workspace_id from meetings where id = meeting_id)))
  with check (user_id = auth.uid() or is_ws_admin((select workspace_id from meetings where id = meeting_id)));

drop policy if exists criteria_select on public.judging_criteria;
create policy criteria_select on public.judging_criteria for select using (is_ws_member(workspace_id));
drop policy if exists criteria_write on public.judging_criteria;
create policy criteria_write on public.judging_criteria for all
  using (is_ws_admin(workspace_id)) with check (is_ws_admin(workspace_id));

-- Judges write their own scores; admins see every score, teams see none until
-- an admin publishes results outside the app.
drop policy if exists scores_select on public.scores;
create policy scores_select on public.scores for select
  using (judge_id = auth.uid()
         or is_ws_admin((select workspace_id from projects where id = project_id)));
drop policy if exists scores_write on public.scores;
create policy scores_write on public.scores for all
  using (judge_id = auth.uid() and is_ws_judge((select workspace_id from projects where id = project_id)))
  with check (judge_id = auth.uid() and is_ws_judge((select workspace_id from projects where id = project_id)));

drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select
  using (is_super_admin() or (workspace_id is not null and is_ws_admin(workspace_id)));

-- ------------------------------------------------------------- triggers ----
drop trigger if exists workspaces_touch on public.workspaces;
create trigger workspaces_touch before update on public.workspaces
  for each row execute function public.touch_updated_at();
drop trigger if exists teams_touch on public.teams;
create trigger teams_touch before update on public.teams
  for each row execute function public.touch_updated_at();
drop trigger if exists meetings_touch on public.meetings;
create trigger meetings_touch before update on public.meetings
  for each row execute function public.touch_updated_at();
drop trigger if exists comments_touch on public.comments;
create trigger comments_touch before update on public.comments
  for each row execute function public.touch_updated_at();

-- Signup now captures the whole request form and leaves the account pending.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb); first_user boolean;
begin
  select count(*) = 0 into first_user from public.profiles;

  insert into public.profiles (
    id, email, full_name, gender, phone, organization, role_title,
    github_url, linkedin_url, country, status, is_super_admin)
  values (
    new.id, new.email,
    coalesce(meta ->> 'full_name', meta ->> 'name'),
    meta ->> 'gender', meta ->> 'phone', meta ->> 'organization', meta ->> 'role_title',
    meta ->> 'github_url', meta ->> 'linkedin_url', meta ->> 'country',
    case when first_user then 'active' else 'pending' end::member_status,
    first_user)
  on conflict (id) do update set email = excluded.email;

  if not first_user then
    insert into public.access_requests (
      user_id, email, full_name, gender, phone, organization, role_title,
      github_url, country, motivation)
    values (
      new.id, new.email, coalesce(meta ->> 'full_name', new.email),
      meta ->> 'gender', meta ->> 'phone', meta ->> 'organization', meta ->> 'role_title',
      meta ->> 'github_url', meta ->> 'country', meta ->> 'motivation');
  end if;

  return new;
end $$;

-- ---------------------------------------------------- reporting helpers ----
-- One row per project with its progress, for the admin dashboard and the
-- weekly roll-up email. Runs through the same policies as the caller.
create or replace view public.project_health with (security_invoker = true) as
select
  p.id, p.workspace_id, p.team_id, p.name, p.color, p.status, p.due_date,
  t.name as team_name,
  count(k.id)                                          as total_tasks,
  count(k.id) filter (where k.status = 'done')         as done_tasks,
  count(k.id) filter (where k.status = 'blocked')      as blocked_tasks,
  count(k.id) filter (where k.status <> 'done' and k.due_date < current_date) as overdue_tasks,
  case when count(k.id) = 0 then 0
       else round(100.0 * count(k.id) filter (where k.status = 'done') / count(k.id)) end as percent_done,
  max(k.updated_at)                                    as last_activity,
  p.repo_url, p.demo_url, p.video_url, p.submitted_at
from public.projects p
left join public.teams t on t.id = p.team_id
left join public.tasks k on k.project_id = p.id
group by p.id, t.name;

grant select on public.project_health to authenticated;

do $$ begin alter publication supabase_realtime add table public.comments; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.workspace_members; exception when duplicate_object then null; end $$;
