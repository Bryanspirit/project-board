-- ============================================================================
-- Web Push subscriptions.
--
-- One row per browser-on-device, not per user: the same person signed in on a
-- phone and a laptop is two subscriptions, and both should ring. The endpoint
-- is the push service's unique handle for that install, so it is the natural
-- primary identity — re-subscribing on the same device returns the same
-- endpoint and must update the row rather than pile up duplicates.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles on delete cascade,
  endpoint     text not null unique,
  -- The two halves of the ECDH keypair the browser hands over. Without both,
  -- the payload cannot be encrypted and the push service will reject it.
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  -- Stamped when the push service reports the subscription is dead (404/410).
  -- Kept rather than deleted so a burst of failures is visible.
  failed_at    timestamptz
);

create index if not exists push_subs_user_idx on public.push_subscriptions (user_id)
  where failed_at is null;

alter table public.push_subscriptions enable row level security;

-- A subscription is only ever the caller's own. The alert job reads them with
-- the service role, which bypasses this entirely.
drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Sits alongside the existing e-mail switches so one screen governs both
-- channels. Defaults off: a notification permission prompt nobody asked for is
-- the fastest way to have it denied for good.
alter table public.profiles add column if not exists push_alerts boolean not null default false;
