-- ============================================================================
-- Fire the notify-admin edge function the moment somebody requests access.
--
-- pg_net queues the request rather than performing it inline, so a slow or
-- unreachable function can never block or fail the signup that triggered it.
--
-- The shared secret lives in Supabase Vault under the name below, NOT in this
-- file — a migration is committed to git, and a header that authenticates an
-- endpoint does not belong there. Create it once with:
--
--   select vault.create_secret('<random-value>', 'notify_admin_webhook_secret');
--
-- and set the same value as the function's WEBHOOK_SECRET:
--
--   supabase secrets set WEBHOOK_SECRET=<random-value>
--
-- If the secret is missing the trigger simply does not fire, and the `access`
-- sweep in scripts/send-alerts.mjs still mails the admin within 15 minutes.
-- ============================================================================

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_admin_of_access_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  secret text;
  fn_url text := 'https://fvgvvkrsncynsfphhvfx.supabase.co/functions/v1/notify-admin';
begin
  begin
    select decrypted_secret into secret
    from vault.decrypted_secrets
    where name = 'notify_admin_webhook_secret'
    limit 1;
  exception when others then
    secret := null;   -- vault unavailable; the sweep is the fallback
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
                 'table', 'access_requests',
                 'record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );

  return new;
end $$;

drop trigger if exists access_request_notify on public.access_requests;
create trigger access_request_notify
  after insert on public.access_requests
  for each row execute function public.notify_admin_of_access_request();
