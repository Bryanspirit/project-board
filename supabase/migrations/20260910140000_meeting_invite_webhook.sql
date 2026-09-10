-- ============================================================================
-- Fire the notify-meeting function the moment somebody is added to a meeting.
--
-- The GitHub Actions sweep remains the safety net, but its cron is best-effort:
-- observed gaps between runs have been as long as three hours, which is no use
-- for a meeting this afternoon. pg_net queues the call, so a slow or missing
-- function can never block or fail the insert that triggered it.
--
-- The secret is the same Vault entry the access-request webhook uses; if it is
-- absent the trigger simply does nothing and the sweep still delivers.
-- ============================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_meeting_attendee()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  secret text;
  fn_url text := 'https://fvgvvkrsncynsfphhvfx.supabase.co/functions/v1/notify-meeting';
begin
  begin
    select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'notify_admin_webhook_secret'
    limit 1;
  exception when others then
    secret := null;
  end;

  if secret is null then
    return new;
  end if;

  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-webhook-secret', secret),
    body    := jsonb_build_object(
                 'type', 'INSERT',
                 'table', 'meeting_attendees',
                 'record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );

  return new;
end $$;

drop trigger if exists meeting_attendee_notify on public.meeting_attendees;
create trigger meeting_attendee_notify
  after insert on public.meeting_attendees
  for each row execute function public.notify_meeting_attendee();
