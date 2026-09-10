-- Emoji removed from the product: the colour plus the row's initials identify a
-- workspace or team, without depending on a font that renders differently on
-- every platform. The columns stay (dropping them would break older clients
-- mid-deploy) but they default to empty and nothing writes them.
alter table public.workspaces alter column emoji set default '';
alter table public.teams      alter column emoji set default '';
update public.workspaces set emoji = '' where emoji <> '';
update public.teams      set emoji = '' where emoji <> '';
