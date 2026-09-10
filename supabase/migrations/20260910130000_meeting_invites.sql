-- ============================================================================
-- Tell people when they are invited, not only when the meeting is imminent.
--
-- `notified_at` is the reminder stamp: it fires inside the 24-hour window. A
-- meeting booked for next month therefore reached nobody until the day before,
-- which is not what scheduling something is supposed to do.
--
-- A second stamp keeps the two apart, so an invitation and a reminder can each
-- fire exactly once for the same attendee.
-- ============================================================================

alter table public.meeting_attendees
  add column if not exists invite_notified_at timestamptz;

create index if not exists attendees_uninvited_idx
  on public.meeting_attendees (meeting_id)
  where invite_notified_at is null;
