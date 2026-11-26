-- Rollback for 20261126100000_play_billing_purchases.sql.
-- NOT a migration. Run only where no store purchase was ever recorded: purchase credits and reversals are append-only
-- ledger entries and cannot be removed. The guard below refuses otherwise.
do $$
begin
  if exists (select 1 from public.token_ledger where reason in ('token_purchase', 'purchase_reversal'))
     or exists (select 1 from public.store_purchases)
     or exists (select 1 from public.subscription_entitlements where provider = 'google_play') then
    raise exception 'Store purchase activity exists; this rollback would lose accounting records. Nothing was changed.';
  end if;
end $$;

drop function if exists public.admin_set_store_product_enabled(text, boolean);
drop function if exists public.admin_set_billing_sandbox(boolean);
drop function if exists public.billing_purchase_by_fingerprint(text, text);
drop function if exists public.billing_rtdn_first_seen(text, text);
drop function if exists public.billing_revoke_play_purchase(text, text, text);
drop function if exists public.billing_mark_completed(text, text, boolean);
drop function if exists public.billing_record_play_purchase(text, uuid, text, text, text, text, boolean, int, timestamptz, timestamptz);
drop function if exists private.purchase_event(bigint, text, text, text);

drop table if exists private.rtdn_messages;
drop table if exists public.store_purchase_events;
drop table if exists public.store_purchases;
drop table if exists public.store_products;
drop table if exists public.billing_settings;

delete from private.integration_secrets where name = 'play_billing';
alter table private.integration_secrets drop constraint integration_secrets_name_check;
alter table private.integration_secrets add constraint integration_secrets_name_check check (name in ('livekit_webhook'));

alter table public.token_ledger drop constraint token_ledger_reason_check;
alter table public.token_ledger add constraint token_ledger_reason_check check (reason in (
  'registration_bonus', 'like', 'message', 'voice_call', 'video_call', 'admin_adjustment', 'refund',
  'booking_hold', 'booking_refund', 'sandbox_grant'));
