-- ============================================================================
-- Three changes:
--   1. Judging is removed entirely — tables, policies and the judge role path.
--   2. Projects and tasks gain a recoverable delete instead of a permanent one.
--   3. Shareable invite links, alongside the existing workspace join codes.
-- ============================================================================

-- ------------------------------------------------------------- 1. judging ---
drop table if exists public.scores cascade;
drop table if exists public.judging_criteria cascade;

-- projects_select granted visibility to owner/admin/judge through is_ws_judge.
-- With judges gone, workspace-wide sight belongs to owners and admins only.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select
  using (
       is_ws_admin(workspace_id)
    or (team_id is not null and is_team_member(team_id))
    or (team_id is null and is_ws_member(workspace_id))
  );

drop function if exists public.is_ws_judge(uuid);

-- The 'judge' value stays in the workspace_role enum: Postgres cannot drop an
-- enum member that historical rows or dropped policies may still reference, and
-- rebuilding the type would mean dropping every policy that depends on it. It
-- is no longer offered anywhere in the UI, so nothing can be assigned it.
update public.workspace_members set role = 'member' where role = 'judge';

-- --------------------------------------------------- 2. recoverable delete ---
alter table public.projects add column if not exists deleted_at timestamptz;
alter table public.tasks    add column if not exists deleted_at timestamptz;

create index if not exists projects_live_idx on public.projects (workspace_id) where deleted_at is null;
create index if not exists tasks_live_idx    on public.tasks (project_id) where deleted_at is null;

-- Deleting a project should carry its tasks into the trash with it, and
-- restoring it should bring back exactly the tasks that went down with it —
-- not ones that were already in the trash beforehand.
create or replace function public.cascade_soft_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.tasks set deleted_at = new.deleted_at
    where project_id = new.id and deleted_at is null;
  elsif new.deleted_at is null and old.deleted_at is not null then
    update public.tasks set deleted_at = null
    where project_id = new.id and deleted_at = old.deleted_at;
  end if;
  return new;
end $$;

drop trigger if exists projects_cascade_trash on public.projects;
create trigger projects_cascade_trash after update of deleted_at on public.projects
  for each row execute function public.cascade_soft_delete();

/** Anything trashed longer than the retention window is gone for good. */
create or replace function public.purge_trash(older_than_days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p integer; t integer;
begin
  if not is_super_admin() then
    return jsonb_build_object('ok', false, 'error', 'not authorised');
  end if;

  with gone as (
    delete from public.tasks
    where deleted_at is not null and deleted_at < now() - make_interval(days => older_than_days)
    returning 1)
  select count(*) into t from gone;

  with gone as (
    delete from public.projects
    where deleted_at is not null and deleted_at < now() - make_interval(days => older_than_days)
    returning 1)
  select count(*) into p from gone;

  return jsonb_build_object('ok', true, 'projects', p, 'tasks', t);
end $$;

-- ---------------------------------------------------- 3. invite links -------
create table if not exists public.invite_links (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  team_id      uuid references public.teams on delete set null,
  token        text not null unique,
  role         workspace_role not null default 'member',
  label        text,
  expires_at   timestamptz,
  max_uses     integer check (max_uses is null or max_uses > 0),
  uses         integer not null default 0,
  revoked      boolean not null default false,
  created_by   uuid references public.profiles on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists invite_links_ws_idx on public.invite_links (workspace_id) where not revoked;

alter table public.invite_links enable row level security;

drop policy if exists invites_select on public.invite_links;
create policy invites_select on public.invite_links for select using (is_ws_admin(workspace_id));
drop policy if exists invites_write on public.invite_links;
create policy invites_write on public.invite_links for all
  using (is_ws_admin(workspace_id)) with check (is_ws_admin(workspace_id));

/**
 * Redeeming runs as definer because the person accepting an invite cannot yet
 * see the workspace, the team, or the link itself. Every rejection returns the
 * same shape so the UI can show a plain reason rather than a Postgres error.
 */
create or replace function public.redeem_invite_link(link_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l record; uid uuid := auth.uid();
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'Sign in first.'); end if;

  select * into l from invite_links where token = trim(link_token);

  if not found        then return jsonb_build_object('ok', false, 'error', 'That invite link is not valid.'); end if;
  if l.revoked        then return jsonb_build_object('ok', false, 'error', 'That invite has been revoked.'); end if;
  if l.expires_at is not null and l.expires_at < now()
                      then return jsonb_build_object('ok', false, 'error', 'That invite has expired.'); end if;
  if l.max_uses is not null and l.uses >= l.max_uses
                      then return jsonb_build_object('ok', false, 'error', 'That invite has been used up.'); end if;

  insert into workspace_members (workspace_id, user_id, role, invited_by)
  values (l.workspace_id, uid, l.role, l.created_by)
  on conflict (workspace_id, user_id) do nothing;

  if l.team_id is not null then
    insert into team_members (team_id, user_id) values (l.team_id, uid)
    on conflict (team_id, user_id) do nothing;
  end if;

  update profiles set status = 'active' where id = uid and status in ('pending', 'rejected');

  -- Only a redemption that actually placed someone counts against max_uses.
  update invite_links set uses = uses + 1 where id = l.id;

  insert into audit_log (actor_id, action, entity_type, entity_id, workspace_id, detail)
  values (uid, 'invite_redeemed', 'invite_link', l.id, l.workspace_id,
          jsonb_build_object('role', l.role, 'team_id', l.team_id));

  return jsonb_build_object('ok', true, 'workspace_id', l.workspace_id, 'team_id', l.team_id);
end $$;

-- ------------------------------------------------- reporting, trash-aware ---
-- project_health drives the dashboards, so it must ignore trashed rows.
drop view if exists public.project_health;
create view public.project_health with (security_invoker = true) as
select
  p.id, p.workspace_id, p.team_id, p.name, p.color, p.status, p.due_date,
  t.name as team_name,
  count(k.id)                                     as total_tasks,
  count(k.id) filter (where k.status = 'done')    as done_tasks,
  count(k.id) filter (where k.status = 'blocked') as blocked_tasks,
  count(k.id) filter (where k.status <> 'done' and k.due_date < current_date) as overdue_tasks,
  case when count(k.id) = 0 then 0
       else round(100.0 * count(k.id) filter (where k.status = 'done') / count(k.id)) end as percent_done,
  max(k.updated_at)                               as last_activity,
  p.repo_url, p.demo_url, p.video_url, p.submitted_at
from public.projects p
left join public.teams t on t.id = p.team_id
left join public.tasks k on k.project_id = p.id and k.deleted_at is null
where p.deleted_at is null
group by p.id, t.name;

grant select on public.project_health to authenticated;

-- Daily task counts per project, for burndown and velocity. Counting from
-- created_at and completed_at means no snapshot table has to be maintained.
create or replace view public.task_activity with (security_invoker = true) as
select
  k.project_id,
  p.workspace_id,
  p.team_id,
  date(k.created_at)   as created_on,
  date(k.completed_at) as completed_on,
  k.id
from public.tasks k
join public.projects p on p.id = k.project_id
where k.deleted_at is null and p.deleted_at is null;

grant select on public.task_activity to authenticated;
