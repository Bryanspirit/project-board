-- ============================================================================
-- Fix: "new row violates row-level security policy for table projects"
--
-- projects_select called can_view_project(id), which re-queries `projects` to
-- decide whether `projects` is readable. That self-reference is fine for an
-- ordinary select, but the function is STABLE, so it sees the snapshot from the
-- start of the statement — and an INSERT ... RETURNING asks the SELECT policy
-- about the very row that statement is still inserting. The row is invisible to
-- the function, the policy says no, and the whole insert is rejected.
--
-- Proof: the same insert with Prefer:return=minimal (no RETURNING) succeeded,
-- while return=representation failed.
--
-- The predicate is now written against the row's own columns instead. Same
-- rule, no self-query, no snapshot to be on the wrong side of — and one fewer
-- index lookup per row.
-- ============================================================================

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select
  using (
       is_ws_judge(workspace_id)
    or (team_id is not null and is_team_member(team_id))
    or (team_id is null and is_ws_member(workspace_id))
  );

-- UPDATE ... RETURNING happens to be safe (the row predates the statement), but
-- the same inlining is cheaper and keeps the two policies reading alike.
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update
  using (
       is_ws_admin(workspace_id)
    or (team_id is not null and is_team_member(team_id))
    or (team_id is null and is_ws_member(workspace_id))
  )
  with check (
       is_ws_admin(workspace_id)
    or (team_id is not null and is_team_member(team_id))
    or (team_id is null and is_ws_member(workspace_id))
  );

-- can_view_project / can_edit_project stay: tasks, comments and attachments
-- reach across to `projects`, which is a different table from their own and so
-- never hits the snapshot problem.

-- ----------------------------------------------------------------------------
-- Second fix, found in the same session: creating a team left team_members
-- empty, so a team lead who was not also a workspace admin could not open a
-- board in the team they had just made. The workspace path already had this
-- trigger; teams were missing the equivalent.
-- ----------------------------------------------------------------------------
create or replace function public.seat_team_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.created_by is not null then
    insert into public.team_members (team_id, user_id, role)
    values (new.id, new.created_by, 'lead')
    on conflict (team_id, user_id) do update set role = 'lead';
  end if;
  return new;
end $$;

drop trigger if exists teams_seat_creator on public.teams;
create trigger teams_seat_creator after insert on public.teams
  for each row execute function public.seat_team_creator();

-- Backfill teams that were created before the trigger existed.
insert into public.team_members (team_id, user_id, role)
select t.id, t.created_by, 'lead'
from public.teams t
where t.created_by is not null
on conflict (team_id, user_id) do nothing;

drop function if exists public.tmp_policy_dump();
