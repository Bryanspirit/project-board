-- ============================================================================
-- Fix: dropping is_ws_judge left can_view_project calling a function that no
-- longer exists.
--
-- Postgres does not resolve the body of a SQL function at DROP time, so
-- removing is_ws_judge succeeded silently and only failed when a policy
-- actually ran — surfacing as 42883 "No function matches the given name" on
-- comments, attachments and task reads. Caught by scripts/smoke-test.mjs.
--
-- Workspace-wide sight now belongs to owners and admins, matching the
-- projects_select policy that was already rewritten the same way.
-- ============================================================================

create or replace function public.can_view_project(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects pr
    where pr.id = p and (
         is_ws_admin(pr.workspace_id)
      or (pr.team_id is not null and is_team_member(pr.team_id))
      or (pr.team_id is null and is_ws_member(pr.workspace_id))
    ));
$$;
