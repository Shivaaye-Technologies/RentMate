-- Rollback for 20261123090000_guest_host_mutes.sql. NOT a migration. Founder approval and a backup first.
-- Apply as a new, timestamped forward migration, newest rollback first. Rehearsed by scripts/test-rollback.mjs.
-- After rolling back, deploy the API version before this change: the current API calls these functions.
drop function if exists public.live_set_guest_mute(uuid, uuid, text, boolean);
drop function if exists public.live_my_publish_sources(uuid);
alter table public.live_guest_invites drop column if exists host_muted_video;
alter table public.live_guest_invites drop column if exists host_muted_audio;
