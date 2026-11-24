-- Rollback for 20261124160000_token_subscription_entitlements.sql.
-- NOT a migration. Keep billing and payout paths disabled; this only removes the entitlement foundation.
-- Rehearsed by scripts/test-rollback.mjs. Apply before the token-wallet rollback (newest first).

-- Remove trigger dependencies before their functions.
drop trigger if exists enforce_like_allowance on public.likes;
drop trigger if exists enforce_dislike_allowance on public.passes;
drop function if exists private.enforce_discovery_action();
drop function if exists private.has_active_subscription(uuid);
drop function if exists public.my_subscription_entitlement();

-- Remove entitlement/catalog/usage data created by this migration.
drop table if exists public.discovery_action_usage;
drop table if exists public.token_package_catalog;
drop table if exists public.subscription_entitlements;

-- Restore the token-wallet configuration values that existed immediately before this migration.
update public.metering_rates
set voice_tokens_per_minute = 10,
    video_tokens_per_second = 1,
    free_likes_per_24h = 50,
    free_messages_per_24h = 10,
    updated_at = now()
where id = 1;

alter table public.metering_rates
  drop column if exists free_dislikes_per_24h,
  drop column if exists free_rewinds_per_24h;
