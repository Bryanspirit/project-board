-- ============================================================================
-- Two corrections found while building the admin screens.
--
-- 1. The signup form collects a LinkedIn URL but access_requests had nowhere
--    to put it, so the reviewer never saw it.
-- 2. Membership tables referenced auth.users, while the name and avatar a
--    reviewer needs live on public.profiles. With no foreign key between the
--    two, PostgREST cannot resolve `profile:profiles(*)` and every member list
--    came back nameless.
--
-- Re-pointing those columns at profiles(id) fixes the embed. Nothing is
-- weakened: profiles.id itself cascades from auth.users, so deleting an account
-- still tears down its memberships — just one hop further along the chain.
-- ============================================================================

alter table public.access_requests add column if not exists linkedin_url text;

-- Guarantee a profile exists for every account before the keys start enforcing it.
insert into public.profiles (id, email, status)
select u.id, coalesce(u.email, ''), 'pending'::member_status
from auth.users u
where u.email is not null
on conflict (id) do nothing;

-- Exactly one foreign key per column, or PostgREST reports the embed as
-- ambiguous and fails just as unhelpfully as having none.
alter table public.workspace_members drop constraint if exists workspace_members_user_id_fkey;
alter table public.workspace_members
  add constraint workspace_members_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

alter table public.team_members drop constraint if exists team_members_user_id_fkey;
alter table public.team_members
  add constraint team_members_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

alter table public.comments drop constraint if exists comments_author_id_fkey;
alter table public.comments
  add constraint comments_author_id_fkey
  foreign key (author_id) references public.profiles (id) on delete cascade;

alter table public.mentions drop constraint if exists mentions_mentioned_user_id_fkey;
alter table public.mentions
  add constraint mentions_mentioned_user_id_fkey
  foreign key (mentioned_user_id) references public.profiles (id) on delete cascade;

alter table public.meeting_attendees drop constraint if exists meeting_attendees_user_id_fkey;
alter table public.meeting_attendees
  add constraint meeting_attendees_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

alter table public.scores drop constraint if exists scores_judge_id_fkey;
alter table public.scores
  add constraint scores_judge_id_fkey
  foreign key (judge_id) references public.profiles (id) on delete cascade;

alter table public.tasks drop constraint if exists tasks_assignee_id_fkey;
alter table public.tasks
  add constraint tasks_assignee_id_fkey
  foreign key (assignee_id) references public.profiles (id) on delete set null;

-- Carry the LinkedIn URL through to the review queue as well as the profile.
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
      github_url, linkedin_url, country, motivation)
    values (
      new.id, new.email, coalesce(meta ->> 'full_name', new.email),
      meta ->> 'gender', meta ->> 'phone', meta ->> 'organization', meta ->> 'role_title',
      meta ->> 'github_url', meta ->> 'linkedin_url', meta ->> 'country', meta ->> 'motivation');
  end if;

  return new;
end $$;

-- ----------------------------------------------------------------------------
-- Seat the creator of a workspace as its owner.
--
-- Without this, creating a workspace leaves you outside it: the insert policy
-- allows owner_id = auth.uid(), but adding the first workspace_members row
-- requires is_ws_admin(), which nobody satisfies until that row exists. RLS
-- would then hide the workspace from the very person who just made it.
-- ----------------------------------------------------------------------------
create or replace function public.seat_workspace_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';

  insert into public.audit_log (actor_id, action, entity_type, entity_id, workspace_id, detail)
  values (auth.uid(), 'workspace_created', 'workspace', new.id, new.id,
          jsonb_build_object('name', new.name, 'kind', new.kind));

  return new;
end $$;

drop trigger if exists workspaces_seat_owner on public.workspaces;
create trigger workspaces_seat_owner after insert on public.workspaces
  for each row execute function public.seat_workspace_owner();
