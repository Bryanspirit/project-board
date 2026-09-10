-- ============================================================================
-- Welcome every new account, and tell the admin it happened.
--
-- Until now a person signed up and heard nothing: the only mail went to the
-- administrator. Someone who joins with a code or an invite link never even
-- reached the approval queue, so nobody heard anything at all.
--
-- The stamp lives on profiles rather than access_requests because a profile is
-- the one row every signup produces, whichever door they came through.
-- ============================================================================

alter table public.profiles
  add column if not exists welcome_sent_at timestamptz;

create index if not exists profiles_unwelcomed_idx
  on public.profiles (created_at)
  where welcome_sent_at is null;

create or replace function public.notify_new_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  secret text;
  fn_url text := 'https://fvgvvkrsncynsfphhvfx.supabase.co/functions/v1/notify-welcome';
begin
  begin
    select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'notify_admin_webhook_secret'
    limit 1;
  exception when others then
    secret := null;
  end;

  -- No secret means no instant mail; the sweep still catches it later.
  if secret is null then
    return new;
  end if;

  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-webhook-secret', secret),
    body    := jsonb_build_object(
                 'type', 'INSERT', 'table', 'profiles', 'record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );

  return new;
end $$;

drop trigger if exists profiles_welcome on public.profiles;
create trigger profiles_welcome
  after insert on public.profiles
  for each row execute function public.notify_new_profile();

-- Existing accounts predate the welcome, so mark them as already greeted
-- rather than mailing everybody the moment this ships.
update public.profiles set welcome_sent_at = created_at where welcome_sent_at is null;
