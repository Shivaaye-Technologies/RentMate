-- SOULMATE LIVE foundation: roles, providers, country and content policy,
-- creators, verification, consent, streams, private sessions, reports,
-- support, appeals, moderation log and an emergency stop.
--
-- Principles enforced here (not only in the app):
-- * Fail closed. A country with no policy row allows nothing. A provider can
--   only be enabled with a signed contract whose terms were reviewed and
--   authorise commercial use. Nobody can go live without passed identity and
--   age checks, an accepted creator agreement, and recorded consent from every
--   other participant.
-- * Explicit content can never be enabled for India (country code IN), and is
--   off everywhere else until an admin records written legal clearance.
-- * Provider secrets are never stored in the database or sent to browsers.
--   live_providers.credential_env only names the server environment variables.
-- * Users cannot approve, verify, pay or un-suspend themselves: those columns
--   are outside the column grants and only change through role-checked
--   functions, each of which writes the append-only moderation log.
--
-- Rollback: docs/LIVE_ARCHITECTURE.md ("Rolling back the foundation").

-- ---------- Roles ----------

create table private.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'moderator')),
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create function private.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.user_roles r
    where r.user_id = (select auth.uid()) and (r.role = p_role or r.role = 'admin')
  );
$$;
revoke execute on function private.has_role(text) from public;
grant execute on function private.has_role(text) to authenticated;

-- Your own live roles (for showing admin pages).
create function public.my_live_roles()
returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(role order by role), '{}')
  from private.user_roles where user_id = (select auth.uid());
$$;
revoke execute on function public.my_live_roles() from public, anon;
grant execute on function public.my_live_roles() to authenticated;

-- ---------- Append-only moderation log ----------

create table public.moderation_actions (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null check (char_length(action) between 2 and 60),
  target_type text not null check (char_length(target_type) between 2 and 40),
  target_id text,
  reason text check (char_length(reason) <= 1000),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.moderation_actions enable row level security;
revoke all on public.moderation_actions from anon, authenticated;
-- No policies: nobody reads or writes it directly. Functions below write it;
-- admins read it through admin_moderation_log().

create function private.log_action(p_action text, p_type text, p_target text, p_reason text, p_details jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.moderation_actions (actor_id, action, target_type, target_id, reason, details)
  values ((select auth.uid()), p_action, p_type, p_target, p_reason, coalesce(p_details, '{}'));
$$;
revoke execute on function private.log_action(text, text, text, text, jsonb) from public;

-- ---------- Settings (emergency stop) ----------

create table public.live_settings (
  id int primary key default 1 check (id = 1),
  emergency_stop boolean not null default false,
  emergency_reason text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.live_settings (id) values (1);
alter table public.live_settings enable row level security;
revoke all on public.live_settings from anon, authenticated;
grant select on public.live_settings to authenticated;
create policy "live settings readable" on public.live_settings for select to authenticated using (true);

-- ---------- Content categories ----------

create table public.content_categories (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  label text not null check (char_length(label) between 2 and 40),
  explicit boolean not null default false
);
insert into public.content_categories (key, label, explicit) values
  ('talk', 'Talk and chat', false),
  ('qa', 'Questions and answers', false),
  ('music', 'Music', false),
  ('video_date', 'Video date', false),
  ('fitness', 'Fitness', false),
  ('gaming', 'Gaming', false),
  ('adult', 'Adult (18+ explicit)', true);
alter table public.content_categories enable row level security;
revoke all on public.content_categories from anon, authenticated;
grant select on public.content_categories to authenticated;
create policy "categories readable" on public.content_categories for select to authenticated using (true);

-- ---------- Country policies ----------

create table public.country_policies (
  country_code text primary key check (country_code ~ '^[A-Z]{2}$'),
  live_allowed boolean not null default false,
  private_sessions_allowed boolean not null default false,
  explicit_allowed boolean not null default false,
  legal_clearance_ref text check (char_length(legal_clearance_ref) <= 200),
  cleared_by uuid,
  cleared_at timestamptz,
  notes text check (char_length(notes) <= 1000),
  updated_at timestamptz not null default now(),
  -- India: explicit content stays off; this cannot be changed from the app.
  constraint no_explicit_in_india check (not (country_code = 'IN' and explicit_allowed)),
  -- Anywhere else, explicit content needs a recorded written legal clearance.
  constraint explicit_needs_clearance check (
    not explicit_allowed
    or (legal_clearance_ref is not null and cleared_by is not null and cleared_at is not null)
  )
);
insert into public.country_policies (country_code, live_allowed, private_sessions_allowed, notes)
values ('IN', true, true, 'Explicit content disabled pending written legal clearance (hard rule).');
alter table public.country_policies enable row level security;
revoke all on public.country_policies from anon, authenticated;
grant select on public.country_policies to authenticated;
create policy "country policies readable" on public.country_policies for select to authenticated using (true);

-- ---------- Providers ----------

create function private.country_codes_ok(codes text[])
returns boolean
language sql immutable set search_path = ''
as $$ select not exists (select 1 from unnest(codes) c where c is null or c !~ '^[A-Z]{2}$'); $$;
revoke execute on function private.country_codes_ok(text[]) from public;
grant execute on function private.country_codes_ok(text[]) to authenticated;

create table public.live_providers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z0-9_-]{2,30}$'),
  name text not null check (char_length(name) between 2 and 60),
  kind text not null default 'webrtc_sfu' check (kind in ('webrtc_sfu', 'white_label', 'affiliate')),
  api_endpoint text not null check (api_endpoint ~ '^(https|wss)://[^\s]+$' and char_length(api_endpoint) <= 200),
  -- Name (prefix) of the server environment variables holding the credentials, never the secret itself.
  credential_env text check (credential_env ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  supported_countries text[] not null default '{}',
  permitted_categories text[] not null default '{}',
  commercial_use boolean not null default false,
  monetisation boolean not null default false,
  contract_status text not null default 'none' check (contract_status in ('none', 'negotiating', 'signed', 'expired', 'terminated')),
  contract_reference text check (char_length(contract_reference) <= 200),
  terms_authorize_model boolean not null default false,
  terms_reviewed_by uuid,
  terms_reviewed_at timestamptz,
  integration_status text not null default 'disabled' check (integration_status in ('disabled', 'testing', 'enabled')),
  notes text check (char_length(notes) <= 1000),
  updated_at timestamptz not null default now(),
  constraint countries_are_codes check (private.country_codes_ok(supported_countries)),
  -- "Do not integrate a provider until its written terms authorise our business model."
  constraint enabled_needs_signed_terms check (
    integration_status <> 'enabled'
    or (
      contract_status = 'signed' and terms_authorize_model and commercial_use
      and contract_reference is not null and terms_reviewed_by is not null and terms_reviewed_at is not null
    )
  ),
  -- Even testing with real users needs at least a contract under negotiation and reviewed terms.
  constraint testing_needs_terms check (
    integration_status <> 'testing' or (contract_status in ('negotiating', 'signed') and terms_reviewed_at is not null)
  )
);
alter table public.live_providers enable row level security;
revoke all on public.live_providers from anon, authenticated;
-- Admins read and write through admin_* functions only.

-- ---------- Creator agreements ----------

create table public.creator_agreements (
  version text primary key check (version ~ '^[0-9A-Za-z._-]{1,20}$'),
  title text not null check (char_length(title) between 2 and 120),
  document_url text not null check (document_url ~ '^https://' and char_length(document_url) <= 300),
  effective_at timestamptz not null default now(),
  active boolean not null default false
);
create unique index creator_agreements_one_active on public.creator_agreements (active) where active;
alter table public.creator_agreements enable row level security;
revoke all on public.creator_agreements from anon, authenticated;
grant select on public.creator_agreements to authenticated;
create policy "agreements readable" on public.creator_agreements for select to authenticated using (true);

-- ---------- Creators ----------

create table public.creators (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  stage_name text not null check (char_length(btrim(stage_name)) between 2 and 40),
  bio text not null default '' check (char_length(bio) <= 500),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  categories text[] not null default '{}',
  status text not null default 'applied' check (status in ('applied', 'verifying', 'approved', 'rejected', 'suspended')),
  agreement_version text references public.creator_agreements (version),
  agreement_accepted_at timestamptz,
  revenue_share_pct numeric(5, 2) check (revenue_share_pct between 0 and 100),
  reviewed_by uuid,
  reviewed_at timestamptz,
  status_reason text check (char_length(status_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.creators enable row level security;
revoke all on public.creators from anon, authenticated;
grant select on public.creators to authenticated;
grant insert (user_id, stage_name, bio, country_code, categories) on public.creators to authenticated;
grant update (stage_name, bio, categories) on public.creators to authenticated;
create policy "creators read own or approved" on public.creators for select to authenticated
  using (user_id = (select auth.uid()) or status = 'approved');
create policy "creators apply as self" on public.creators for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "creators edit own" on public.creators for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- Verifications (results from a verification provider) ----------

create table public.creator_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.creators (user_id) on delete cascade,
  kind text not null check (kind in ('identity', 'age')),
  provider text not null check (char_length(provider) between 2 and 60),
  -- The provider's case or inquiry id. No document images or numbers are stored here.
  provider_reference text not null check (char_length(provider_reference) between 3 and 120),
  status text not null check (status in ('pending', 'passed', 'failed', 'expired')),
  verified_country text check (verified_country ~ '^[A-Z]{2}$'),
  over_18 boolean,
  checked_at timestamptz not null default now(),
  expires_at timestamptz,
  recorded_by uuid,
  constraint age_pass_means_adult check (not (kind = 'age' and status = 'passed' and over_18 is not true))
);
create index creator_verifications_user_idx on public.creator_verifications (user_id, kind, checked_at desc);
alter table public.creator_verifications enable row level security;
revoke all on public.creator_verifications from anon, authenticated;
grant select on public.creator_verifications to authenticated;
create policy "verifications read own" on public.creator_verifications for select to authenticated
  using (user_id = (select auth.uid()));

-- Latest result of each kind, passed and not expired.
create function private.verified(p_user uuid, p_kind text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select v.status = 'passed' and (v.expires_at is null or v.expires_at > now())
           and (p_kind <> 'age' or v.over_18)
    from public.creator_verifications v
    where v.user_id = p_user and v.kind = p_kind
    order by v.checked_at desc limit 1
  ), false);
$$;
revoke execute on function private.verified(uuid, text) from public;

create function private.verified_country(p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select v.verified_country from public.creator_verifications v
  where v.user_id = p_user and v.kind = 'identity' and v.status = 'passed'
  order by v.checked_at desc limit 1;
$$;
revoke execute on function private.verified_country(uuid) from public;

-- Viewers of explicit content also need a passed age check. They can have a
-- verification row without being a creator, so viewer checks are separate.
create table public.viewer_age_checks (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  provider text not null check (char_length(provider) between 2 and 60),
  provider_reference text not null check (char_length(provider_reference) between 3 and 120),
  status text not null check (status in ('pending', 'passed', 'failed', 'expired')),
  verified_country text check (verified_country ~ '^[A-Z]{2}$'),
  over_18 boolean,
  checked_at timestamptz not null default now(),
  constraint viewer_pass_means_adult check (not (status = 'passed' and over_18 is not true))
);
alter table public.viewer_age_checks enable row level security;
revoke all on public.viewer_age_checks from anon, authenticated;
grant select on public.viewer_age_checks to authenticated;
create policy "viewer age read own" on public.viewer_age_checks for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------- Streams ----------

create table public.live_streams (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (user_id) on delete cascade,
  provider_key text not null references public.live_providers (key),
  title text not null check (char_length(btrim(title)) between 3 and 80),
  category text not null references public.content_categories (key),
  scheduled_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended', 'terminated', 'cancelled')),
  -- Co-performers (other approved creators). Each needs their own consent record.
  participants uuid[] not null default '{}',
  -- Optional narrower list of countries; null means every country whose policy allows it.
  countries_allowed text[],
  room_name text not null unique default ('sm-' || replace(gen_random_uuid()::text, '-', '')),
  started_at timestamptz,
  ended_at timestamptz,
  terminated_by uuid,
  termination_reason text check (char_length(termination_reason) <= 1000),
  created_at timestamptz not null default now(),
  constraint creator_not_participant check (not (creator_id = any (participants))),
  constraint stream_countries_are_codes check (countries_allowed is null or private.country_codes_ok(countries_allowed)),
  constraint few_participants check (cardinality(participants) <= 4)
);
create index live_streams_status_idx on public.live_streams (status, scheduled_at);
alter table public.live_streams enable row level security;
revoke all on public.live_streams from anon, authenticated;
grant select on public.live_streams to authenticated;
grant insert (creator_id, provider_key, title, category, scheduled_at, participants, countries_allowed)
  on public.live_streams to authenticated;
grant update (title, scheduled_at) on public.live_streams to authenticated;

create function private.is_explicit(p_category text)
returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select c.explicit from public.content_categories c where c.key = p_category), true); $$;
revoke execute on function private.is_explicit(text) from public;
grant execute on function private.is_explicit(text) to authenticated;

-- Own and co-performed streams are readable; others only when non-explicit.
-- Explicit streams reach viewers only through the API, which checks country.
create policy "streams readable" on public.live_streams for select to authenticated
  using (
    creator_id = (select auth.uid())
    or (select auth.uid()) = any (participants)
    or (not private.is_explicit(category) and status in ('scheduled', 'live')
        and not private.blocked_either(creator_id))
  );
-- Creators schedule their own streams; going live is a separate checked step.
create policy "streams schedule own" on public.live_streams for insert to authenticated
  with check (
    creator_id = (select auth.uid())
    and exists (select 1 from public.creators c where c.user_id = creator_id and c.status = 'approved')
  );
create policy "streams edit own scheduled" on public.live_streams for update to authenticated
  using (creator_id = (select auth.uid()) and status = 'scheduled')
  with check (creator_id = (select auth.uid()) and status = 'scheduled');

-- ---------- Consent from every participant ----------

create table public.performer_consents (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams (id) on delete cascade,
  participant_id uuid not null references public.creators (user_id) on delete cascade,
  consent_scope text not null check (char_length(consent_scope) between 3 and 500),
  -- Reference to the signed consent document held by the verification/e-sign provider.
  document_ref text not null check (char_length(document_ref) between 3 and 200),
  signed_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (stream_id, participant_id)
);
alter table public.performer_consents enable row level security;
revoke all on public.performer_consents from anon, authenticated;
grant select on public.performer_consents to authenticated;
create policy "consents read own streams" on public.performer_consents for select to authenticated
  using (
    participant_id = (select auth.uid())
    or exists (select 1 from public.live_streams s where s.id = stream_id and s.creator_id = (select auth.uid()))
  );

-- ---------- Availability ----------

create table public.creator_availability (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (user_id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 3 and 60),
  constraint window_order check (start_minute < end_minute)
);
alter table public.creator_availability enable row level security;
revoke all on public.creator_availability from anon, authenticated;
grant select, insert, delete on public.creator_availability to authenticated;
create policy "availability read" on public.creator_availability for select to authenticated using (
  creator_id = (select auth.uid())
  or exists (select 1 from public.creators c where c.user_id = creator_id and c.status = 'approved')
);
create policy "availability own" on public.creator_availability for insert to authenticated
  with check (creator_id = (select auth.uid()));
create policy "availability delete own" on public.creator_availability for delete to authenticated
  using (creator_id = (select auth.uid()));

-- ---------- Private video and audio sessions ----------

create table public.private_sessions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (user_id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  mode text not null check (mode in ('video', 'audio')),
  category text not null references public.content_categories (key),
  requested_for timestamptz,
  status text not null default 'requested' check (status in ('requested', 'accepted', 'declined', 'active', 'ended', 'terminated', 'cancelled')),
  room_name text not null unique default ('ps-' || replace(gen_random_uuid()::text, '-', '')),
  provider_key text not null references public.live_providers (key),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint not_self check (creator_id <> viewer_id)
);
alter table public.private_sessions enable row level security;
revoke all on public.private_sessions from anon, authenticated;
grant select on public.private_sessions to authenticated;
grant insert (creator_id, viewer_id, mode, category, requested_for, provider_key) on public.private_sessions to authenticated;
create policy "sessions read own" on public.private_sessions for select to authenticated
  using ((select auth.uid()) in (creator_id, viewer_id));
create policy "sessions request as viewer" on public.private_sessions for insert to authenticated
  with check (
    viewer_id = (select auth.uid())
    and exists (select 1 from public.creators c where c.user_id = creator_id and c.status = 'approved')
    and not private.blocked_either(creator_id)
  );

-- ---------- Reports ----------

create table public.live_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  stream_id uuid references public.live_streams (id) on delete set null,
  session_id uuid references public.private_sessions (id) on delete set null,
  creator_id uuid references public.creators (user_id) on delete set null,
  reason text not null check (reason in (
    'minor', 'non_consensual', 'trafficking_or_coercion', 'leaked_or_stolen', 'violence',
    'harassment', 'hate', 'spam_or_scam', 'illegal_in_my_country', 'other'
  )),
  details text not null default '' check (char_length(details) <= 1000),
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  handled_by uuid,
  handled_at timestamptz,
  handling_note text check (char_length(handling_note) <= 1000),
  created_at timestamptz not null default now(),
  constraint has_target check (stream_id is not null or session_id is not null or creator_id is not null)
);
alter table public.live_reports enable row level security;
revoke all on public.live_reports from anon, authenticated;
grant select on public.live_reports to authenticated;
grant insert (reporter_id, stream_id, session_id, creator_id, reason, details) on public.live_reports to authenticated;
create policy "live reports insert own" on public.live_reports for insert to authenticated
  with check (reporter_id = (select auth.uid()));
create policy "live reports read own" on public.live_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

-- Reports about minors, consent, trafficking or leaked content are urgent.
create function private.live_report_priority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.priority := case when new.reason in ('minor', 'non_consensual', 'trafficking_or_coercion', 'leaked_or_stolen', 'violence')
                       then 'urgent' else 'normal' end;
  new.status := 'open';
  new.handled_by := null;
  new.handled_at := null;
  if (select count(*) from public.live_reports r
      where r.reporter_id = new.reporter_id and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'Daily report limit reached.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger live_reports_priority before insert on public.live_reports
  for each row execute function private.live_report_priority();

-- ---------- Support tickets and appeals ----------

create table public.creator_tickets (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (user_id) on delete cascade,
  subject text not null check (char_length(btrim(subject)) between 3 and 120),
  body text not null check (char_length(btrim(body)) between 3 and 2000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  admin_reply text check (char_length(admin_reply) <= 2000),
  replied_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.creator_tickets enable row level security;
revoke all on public.creator_tickets from anon, authenticated;
grant select on public.creator_tickets to authenticated;
grant insert (creator_id, subject, body) on public.creator_tickets to authenticated;
create policy "tickets read own" on public.creator_tickets for select to authenticated
  using (creator_id = (select auth.uid()));
create policy "tickets open own" on public.creator_tickets for insert to authenticated
  with check (creator_id = (select auth.uid()));

create table public.creator_appeals (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (user_id) on delete cascade,
  statement text not null check (char_length(btrim(statement)) between 10 and 2000),
  status text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  decision_note text check (char_length(decision_note) <= 2000),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index creator_appeals_one_open on public.creator_appeals (creator_id) where status = 'open';
alter table public.creator_appeals enable row level security;
revoke all on public.creator_appeals from anon, authenticated;
grant select on public.creator_appeals to authenticated;
grant insert (creator_id, statement) on public.creator_appeals to authenticated;
create policy "appeals read own" on public.creator_appeals for select to authenticated
  using (creator_id = (select auth.uid()));
-- Only suspended or rejected creators can appeal.
create policy "appeals file own" on public.creator_appeals for insert to authenticated
  with check (
    creator_id = (select auth.uid())
    and exists (select 1 from public.creators c where c.user_id = creator_id and c.status in ('suspended', 'rejected'))
  );

-- ---------- Decisions: may this person broadcast / watch? ----------

-- Every reason a stream may not go live right now (empty = allowed).
create function private.broadcast_problems(p_stream uuid, p_user uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.live_streams;
  c public.creators;
  p public.live_providers;
  pol public.country_policies;
  country text;
  explicit boolean;
  out text[] := '{}';
  part uuid;
begin
  select * into s from public.live_streams where id = p_stream;
  if not found then return array['stream_not_found']; end if;
  if s.creator_id <> p_user and not (p_user = any (s.participants)) then return array['not_your_stream']; end if;
  if s.status not in ('scheduled', 'live') then out := array_append(out, 'stream_not_open'::text); end if;
  if (select emergency_stop from public.live_settings where id = 1) then out := array_append(out, 'emergency_stop'::text); end if;

  select * into c from public.creators where user_id = s.creator_id;
  if c.status <> 'approved' then out := array_append(out, 'creator_not_approved'::text); end if;
  if c.agreement_accepted_at is null
     or c.agreement_version is distinct from (select version from public.creator_agreements where active) then
    out := array_append(out, 'agreement_not_accepted'::text);
  end if;
  if not private.verified(s.creator_id, 'identity') then out := array_append(out, 'identity_not_verified'::text); end if;
  if not private.verified(s.creator_id, 'age') then out := array_append(out, 'age_not_verified'::text); end if;

  country := coalesce(private.verified_country(s.creator_id), c.country_code);
  select * into pol from public.country_policies where country_code = country;
  if not found or not pol.live_allowed then out := array_append(out, 'country_not_allowed'::text); end if;

  explicit := private.is_explicit(s.category);
  if explicit and (country = 'IN' or not coalesce(pol.explicit_allowed, false)) then
    out := array_append(out, 'explicit_not_allowed_in_country'::text);
  end if;
  if not (s.category = any (c.categories)) then out := array_append(out, 'category_not_in_application'::text); end if;

  select * into p from public.live_providers where key = s.provider_key;
  if not found or p.integration_status = 'disabled' then out := array_append(out, 'provider_not_enabled'::text); end if;
  if found and not (s.category = any (p.permitted_categories)) then out := array_append(out, 'category_not_permitted_by_provider'::text); end if;
  if found and cardinality(p.supported_countries) > 0 and not (country = any (p.supported_countries)) then
    out := array_append(out, 'country_not_supported_by_provider'::text);
  end if;

  -- Every co-performer: approved, verified, and has given consent for this stream.
  foreach part in array s.participants loop
    if not exists (select 1 from public.creators x where x.user_id = part and x.status = 'approved')
       or not private.verified(part, 'identity') or not private.verified(part, 'age') then
      out := array_append(out, ('participant_not_verified:' || part::text)::text);
    end if;
    if not exists (select 1 from public.performer_consents pc
                   where pc.stream_id = s.id and pc.participant_id = part and pc.revoked_at is null) then
      out := array_append(out, ('participant_consent_missing:' || part::text)::text);
    end if;
  end loop;
  return out;
end;
$$;
revoke execute on function private.broadcast_problems(uuid, uuid) from public;

-- Every reason this viewer may not watch (empty = allowed).
-- viewer_country comes from the API (IP geolocation); null means unknown.
create function private.watch_problems(p_stream uuid, p_user uuid, p_viewer_country text)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.live_streams;
  pol public.country_policies;
  explicit boolean;
  age public.viewer_age_checks;
  ccreator text;
  out text[] := '{}';
begin
  select * into s from public.live_streams where id = p_stream;
  if not found then return array['stream_not_found']; end if;
  if s.status <> 'live' then out := array_append(out, 'stream_not_live'::text); end if;
  if (select emergency_stop from public.live_settings where id = 1) then out := array_append(out, 'emergency_stop'::text); end if;
  if exists (select 1 from public.blocks b
             where (b.blocker_id = p_user and b.blocked_id = s.creator_id)
                or (b.blocker_id = s.creator_id and b.blocked_id = p_user)) then
    out := array_append(out, 'blocked'::text);
  end if;
  if p_viewer_country is null then
    out := array_append(out, 'country_unknown'::text);
  else
    select * into pol from public.country_policies where country_code = p_viewer_country;
    if not found or not pol.live_allowed then out := array_append(out, 'country_not_allowed'::text); end if;
    if s.countries_allowed is not null and not (p_viewer_country = any (s.countries_allowed)) then
      out := array_append(out, 'stream_not_in_country'::text);
    end if;
  end if;

  explicit := private.is_explicit(s.category);
  if explicit then
    -- The creator's side must be allowed too (never India).
    ccreator := coalesce(private.verified_country(s.creator_id),
                         (select c.country_code from public.creators c where c.user_id = s.creator_id));
    if ccreator = 'IN' or not exists (select 1 from public.country_policies cp
                                      where cp.country_code = ccreator and cp.explicit_allowed) then
      out := array_append(out, 'explicit_not_allowed_in_creator_country'::text);
    end if;
    if p_viewer_country is null or p_viewer_country = 'IN' or not coalesce(pol.explicit_allowed, false) then
      out := array_append(out, 'explicit_not_allowed_in_country'::text);
    end if;
    select * into age from public.viewer_age_checks where user_id = p_user;
    if not found or age.status <> 'passed' or not coalesce(age.over_18, false) then
      out := array_append(out, 'viewer_age_not_verified'::text);
    elsif age.verified_country = 'IN' then
      out := array_append(out, 'explicit_not_allowed_in_country'::text);
    end if;
  end if;
  return out;
end;
$$;
revoke execute on function private.watch_problems(uuid, uuid, text) from public;

-- Public entry points used by the API (with the caller's own token).
create function public.live_broadcast_check(p_stream uuid)
returns text[]
language sql stable security definer set search_path = ''
as $$ select private.broadcast_problems(p_stream, (select auth.uid())); $$;

create function public.live_watch_check(p_stream uuid, p_viewer_country text)
returns text[]
language sql stable security definer set search_path = ''
as $$ select private.watch_problems(p_stream, (select auth.uid()), upper(nullif(btrim(p_viewer_country), ''))); $$;

-- What the API needs to issue a token: room and provider key (never secrets).
create function public.live_room_for(p_stream uuid)
returns table (room_name text, provider_key text, creator_id uuid, explicit boolean, status text)
language sql stable security definer set search_path = ''
as $$
  select s.room_name, s.provider_key, s.creator_id, private.is_explicit(s.category), s.status
  from public.live_streams s where s.id = p_stream;
$$;

revoke execute on function public.live_broadcast_check(uuid) from public, anon;
revoke execute on function public.live_watch_check(uuid, text) from public, anon;
revoke execute on function public.live_room_for(uuid) from public, anon;
grant execute on function public.live_broadcast_check(uuid) to authenticated;
grant execute on function public.live_watch_check(uuid, text) to authenticated;
grant execute on function public.live_room_for(uuid) to authenticated;

-- Go live / end: only the creator, only when every check passes.
create function public.live_start_stream(p_stream uuid)
returns text[]
language plpgsql security definer set search_path = ''
as $$
declare problems text[];
begin
  problems := private.broadcast_problems(p_stream, (select auth.uid()));
  if (select creator_id from public.live_streams where id = p_stream) is distinct from (select auth.uid()) then
    return array['only_the_creator_can_start'];
  end if;
  if cardinality(problems) > 0 then return problems; end if;
  update public.live_streams set status = 'live', started_at = coalesce(started_at, now()) where id = p_stream;
  return '{}';
end;
$$;

create function public.live_end_stream(p_stream uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.live_streams set status = 'ended', ended_at = now()
  where id = p_stream and creator_id = (select auth.uid()) and status in ('scheduled', 'live');
$$;

-- A participant gives (or revokes) their own consent for a stream.
create function public.live_give_consent(p_stream uuid, p_scope text, p_document_ref text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.live_streams s where s.id = p_stream and (select auth.uid()) = any (s.participants)) then
    raise exception 'You are not a participant of this stream' using errcode = '42501';
  end if;
  insert into public.performer_consents (stream_id, participant_id, consent_scope, document_ref)
  values (p_stream, (select auth.uid()), p_scope, p_document_ref)
  on conflict (stream_id, participant_id)
  do update set consent_scope = excluded.consent_scope, document_ref = excluded.document_ref,
                signed_at = now(), revoked_at = null;
end;
$$;

create function public.live_revoke_consent(p_stream uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.performer_consents set revoked_at = now()
  where stream_id = p_stream and participant_id = (select auth.uid()) and revoked_at is null;
$$;

-- Accept the active creator agreement.
create function public.live_accept_agreement(p_version text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.creator_agreements where version = p_version and active) then
    raise exception 'That agreement version is not the active one' using errcode = '22023';
  end if;
  update public.creators set agreement_version = p_version, agreement_accepted_at = now(), updated_at = now()
  where user_id = (select auth.uid());
  if not found then raise exception 'Apply as a creator first' using errcode = '42501'; end if;
end;
$$;

-- Creator answers a private session request.
create function public.live_answer_session(p_session uuid, p_accept boolean)
returns void
language sql security definer set search_path = ''
as $$
  update public.private_sessions set status = case when p_accept then 'accepted' else 'declined' end
  where id = p_session and creator_id = (select auth.uid()) and status = 'requested';
$$;

-- Either side ends a session.
create function public.live_end_session(p_session uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.private_sessions set status = 'ended', ended_at = now()
  where id = p_session and (select auth.uid()) in (creator_id, viewer_id) and status in ('requested', 'accepted', 'active');
$$;

-- May this user join this private session? (empty = allowed)
create function public.live_session_check(p_session uuid, p_viewer_country text)
returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  ps public.private_sessions;
  me uuid := (select auth.uid());
  pol public.country_policies;
  cc text := upper(nullif(btrim(p_viewer_country), ''));
  out text[] := '{}';
  age public.viewer_age_checks;
  ccreator text;
begin
  select * into ps from public.private_sessions where id = p_session;
  if not found or me not in (ps.creator_id, ps.viewer_id) then return array['session_not_found']; end if;
  if ps.status not in ('accepted', 'active') then out := array_append(out, 'session_not_accepted'::text); end if;
  if (select emergency_stop from public.live_settings where id = 1) then out := array_append(out, 'emergency_stop'::text); end if;
  if private.blocked_either(case when me = ps.creator_id then ps.viewer_id else ps.creator_id end) then
    out := array_append(out, 'blocked'::text);
  end if;
  if not exists (select 1 from public.creators c where c.user_id = ps.creator_id and c.status = 'approved')
     or not private.verified(ps.creator_id, 'identity') or not private.verified(ps.creator_id, 'age') then
    out := array_append(out, 'creator_not_verified'::text);
  end if;
  if not exists (select 1 from public.live_providers p where p.key = ps.provider_key and p.integration_status <> 'disabled') then
    out := array_append(out, 'provider_not_enabled'::text);
  end if;
  if me = ps.viewer_id then
    if cc is null then out := array_append(out, 'country_unknown'::text);
    else
      select * into pol from public.country_policies where country_code = cc;
      if not found or not pol.private_sessions_allowed then out := array_append(out, 'country_not_allowed'::text); end if;
    end if;
  end if;
  ccreator := coalesce(private.verified_country(ps.creator_id),
                       (select country_code from public.creators where user_id = ps.creator_id));
  if not exists (select 1 from public.country_policies where country_code = ccreator and private_sessions_allowed) then
    out := array_append(out, 'creator_country_not_allowed'::text);
  end if;
  if private.is_explicit(ps.category) then
    if ccreator = 'IN' or cc = 'IN' or cc is null
       or not exists (select 1 from public.country_policies where country_code = ccreator and explicit_allowed)
       or not exists (select 1 from public.country_policies where country_code = cc and explicit_allowed) then
      out := array_append(out, 'explicit_not_allowed_in_country'::text);
    end if;
    select * into age from public.viewer_age_checks where user_id = ps.viewer_id;
    if not found or age.status <> 'passed' or age.verified_country = 'IN' then
      out := array_append(out, 'viewer_age_not_verified'::text);
    end if;
  end if;
  return out;
end;
$$;

create function public.live_session_room(p_session uuid)
returns table (room_name text, provider_key text, mode text)
language sql stable security definer set search_path = ''
as $$
  select room_name, provider_key, mode from public.private_sessions
  where id = p_session and (select auth.uid()) in (creator_id, viewer_id);
$$;

-- Viewer-facing list: live and upcoming streams this viewer may see.
create function public.live_list_streams(p_viewer_country text)
returns table (id uuid, creator_id uuid, stage_name text, title text, category text, explicit boolean,
               status text, scheduled_at timestamptz, started_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.creator_id, c.stage_name, s.title, s.category, private.is_explicit(s.category),
         s.status, s.scheduled_at, s.started_at
  from public.live_streams s
  join public.creators c on c.user_id = s.creator_id
  where s.status in ('scheduled', 'live')
    and c.status = 'approved'
    and not private.blocked_either(s.creator_id)
    -- Explicit streams appear only to viewers who could watch them (being not live yet is fine).
    and (not private.is_explicit(s.category)
         or not exists (
           select 1 from unnest(private.watch_problems(s.id, (select auth.uid()), upper(nullif(btrim(p_viewer_country), '')))) x
           where x <> 'stream_not_live'))
  order by (s.status = 'live') desc, coalesce(s.started_at, s.scheduled_at) asc
  limit 200;
$$;

revoke execute on function public.live_start_stream(uuid) from public, anon;
revoke execute on function public.live_end_stream(uuid) from public, anon;
revoke execute on function public.live_give_consent(uuid, text, text) from public, anon;
revoke execute on function public.live_revoke_consent(uuid) from public, anon;
revoke execute on function public.live_accept_agreement(text) from public, anon;
revoke execute on function public.live_answer_session(uuid, boolean) from public, anon;
revoke execute on function public.live_end_session(uuid) from public, anon;
revoke execute on function public.live_session_check(uuid, text) from public, anon;
revoke execute on function public.live_session_room(uuid) from public, anon;
revoke execute on function public.live_list_streams(text) from public, anon;
grant execute on function public.live_start_stream(uuid) to authenticated;
grant execute on function public.live_end_stream(uuid) to authenticated;
grant execute on function public.live_give_consent(uuid, text, text) to authenticated;
grant execute on function public.live_revoke_consent(uuid) to authenticated;
grant execute on function public.live_accept_agreement(text) to authenticated;
grant execute on function public.live_answer_session(uuid, boolean) to authenticated;
grant execute on function public.live_end_session(uuid) to authenticated;
grant execute on function public.live_session_check(uuid, text) to authenticated;
grant execute on function public.live_session_room(uuid) to authenticated;
grant execute on function public.live_list_streams(text) to authenticated;

-- ---------- Admin and moderator functions (role-checked, logged) ----------

create function private.require_role(p_role text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_role(p_role) then
    raise exception 'This needs the % role', p_role using errcode = '42501';
  end if;
end;
$$;
revoke execute on function private.require_role(text) from public;

create function public.admin_set_role(p_user uuid, p_role text, p_grant boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  if p_role not in ('admin', 'moderator') then raise exception 'Unknown role' using errcode = '22023'; end if;
  if p_user = (select auth.uid()) and p_role = 'admin' and not p_grant then
    raise exception 'You cannot remove your own admin role' using errcode = '42501';
  end if;
  if p_grant then
    insert into private.user_roles (user_id, role, granted_by) values (p_user, p_role, (select auth.uid()))
    on conflict do nothing;
  else
    delete from private.user_roles where user_id = p_user and role = p_role;
  end if;
  perform private.log_action(case when p_grant then 'role_granted' else 'role_revoked' end, 'user', p_user::text, p_role);
end;
$$;

create function public.admin_upsert_provider(
  p_key text, p_name text, p_kind text, p_api_endpoint text, p_credential_env text,
  p_supported_countries text[], p_permitted_categories text[], p_commercial_use boolean, p_monetisation boolean,
  p_contract_status text, p_contract_reference text, p_terms_authorize_model boolean, p_terms_reviewed boolean,
  p_integration_status text, p_notes text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  insert into public.live_providers as lp (
    key, name, kind, api_endpoint, credential_env, supported_countries, permitted_categories, commercial_use,
    monetisation, contract_status, contract_reference, terms_authorize_model, terms_reviewed_by, terms_reviewed_at,
    integration_status, notes, updated_at
  ) values (
    p_key, p_name, p_kind, p_api_endpoint, p_credential_env, coalesce(p_supported_countries, '{}'),
    coalesce(p_permitted_categories, '{}'), p_commercial_use, p_monetisation, p_contract_status, p_contract_reference,
    p_terms_authorize_model, case when p_terms_reviewed then (select auth.uid()) end,
    case when p_terms_reviewed then now() end, p_integration_status, p_notes, now()
  )
  on conflict (key) do update set
    name = excluded.name, kind = excluded.kind, api_endpoint = excluded.api_endpoint,
    credential_env = excluded.credential_env, supported_countries = excluded.supported_countries,
    permitted_categories = excluded.permitted_categories, commercial_use = excluded.commercial_use,
    monetisation = excluded.monetisation, contract_status = excluded.contract_status,
    contract_reference = excluded.contract_reference, terms_authorize_model = excluded.terms_authorize_model,
    terms_reviewed_by = case when p_terms_reviewed then (select auth.uid()) else lp.terms_reviewed_by end,
    terms_reviewed_at = case when p_terms_reviewed then now() else lp.terms_reviewed_at end,
    integration_status = excluded.integration_status, notes = excluded.notes, updated_at = now();
  perform private.log_action('provider_saved', 'provider', p_key, null,
    jsonb_build_object('integration_status', p_integration_status, 'contract_status', p_contract_status));
end;
$$;

create function public.admin_list_providers()
returns setof public.live_providers
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query select * from public.live_providers order by name;
end;
$$;

create function public.admin_set_country_policy(
  p_country text, p_live boolean, p_private boolean, p_explicit boolean, p_clearance_ref text, p_notes text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  insert into public.country_policies as cp (country_code, live_allowed, private_sessions_allowed, explicit_allowed,
                                             legal_clearance_ref, cleared_by, cleared_at, notes, updated_at)
  values (upper(p_country), p_live, p_private, p_explicit, p_clearance_ref,
          case when p_explicit then (select auth.uid()) end, case when p_explicit then now() end, p_notes, now())
  on conflict (country_code) do update set
    live_allowed = excluded.live_allowed, private_sessions_allowed = excluded.private_sessions_allowed,
    explicit_allowed = excluded.explicit_allowed, legal_clearance_ref = excluded.legal_clearance_ref,
    cleared_by = excluded.cleared_by, cleared_at = excluded.cleared_at, notes = excluded.notes, updated_at = now();
  perform private.log_action('country_policy_saved', 'country', upper(p_country), p_notes,
    jsonb_build_object('live', p_live, 'private', p_private, 'explicit', p_explicit, 'clearance_ref', p_clearance_ref));
end;
$$;

create function public.admin_set_agreement(p_version text, p_title text, p_url text, p_activate boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  if p_activate then update public.creator_agreements set active = false where active; end if;
  insert into public.creator_agreements (version, title, document_url, active)
  values (p_version, p_title, p_url, p_activate)
  on conflict (version) do update set title = excluded.title, document_url = excluded.document_url,
    active = excluded.active;
  perform private.log_action('agreement_saved', 'agreement', p_version, null, jsonb_build_object('active', p_activate));
end;
$$;

create function public.admin_review_creator(p_user uuid, p_status text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  if p_status not in ('verifying', 'approved', 'rejected', 'suspended') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  if p_status = 'approved' and (not private.verified(p_user, 'identity') or not private.verified(p_user, 'age')) then
    raise exception 'Identity and age must both be verified before approval' using errcode = '22023';
  end if;
  update public.creators set status = p_status, status_reason = p_reason, reviewed_by = (select auth.uid()),
    reviewed_at = now(), updated_at = now()
  where user_id = p_user;
  if not found then raise exception 'No such creator' using errcode = '22023'; end if;
  -- Suspension ends any stream or session in progress.
  if p_status in ('suspended', 'rejected') then
    update public.live_streams set status = 'terminated', ended_at = now(), terminated_by = (select auth.uid()),
      termination_reason = 'Creator ' || p_status
    where creator_id = p_user and status in ('scheduled', 'live');
    update public.private_sessions set status = 'terminated', ended_at = now()
    where creator_id = p_user and status in ('requested', 'accepted', 'active');
  end if;
  perform private.log_action('creator_' || p_status, 'creator', p_user::text, p_reason);
end;
$$;

-- Records a verification provider's result (from its dashboard or webhook relay).
create function public.admin_record_verification(
  p_user uuid, p_kind text, p_provider text, p_reference text, p_status text,
  p_country text, p_over_18 boolean, p_expires_at timestamptz
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  insert into public.creator_verifications (user_id, kind, provider, provider_reference, status, verified_country,
                                            over_18, expires_at, recorded_by)
  values (p_user, p_kind, p_provider, p_reference, p_status, upper(p_country), p_over_18, p_expires_at, (select auth.uid()));
  perform private.log_action('verification_recorded', 'creator', p_user::text, null,
    jsonb_build_object('kind', p_kind, 'status', p_status, 'provider', p_provider));
end;
$$;

create function public.admin_record_viewer_age(
  p_user uuid, p_provider text, p_reference text, p_status text, p_country text, p_over_18 boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  insert into public.viewer_age_checks (user_id, provider, provider_reference, status, verified_country, over_18)
  values (p_user, p_provider, p_reference, p_status, upper(p_country), p_over_18)
  on conflict (user_id) do update set provider = excluded.provider, provider_reference = excluded.provider_reference,
    status = excluded.status, verified_country = excluded.verified_country, over_18 = excluded.over_18,
    checked_at = now();
  perform private.log_action('viewer_age_recorded', 'user', p_user::text, null, jsonb_build_object('status', p_status));
end;
$$;

create function public.admin_set_revenue_share(p_user uuid, p_pct numeric)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  update public.creators set revenue_share_pct = p_pct, updated_at = now() where user_id = p_user;
  perform private.log_action('revenue_share_set', 'creator', p_user::text, null, jsonb_build_object('pct', p_pct));
end;
$$;

-- Moderators: end a stream immediately. The API also closes the provider room.
create function public.live_terminate_stream(p_stream uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  update public.live_streams set status = 'terminated', ended_at = now(), terminated_by = (select auth.uid()),
    termination_reason = p_reason
  where id = p_stream and status in ('scheduled', 'live');
  perform private.log_action('stream_terminated', 'stream', p_stream::text, p_reason);
end;
$$;

create function public.live_terminate_session(p_session uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  update public.private_sessions set status = 'terminated', ended_at = now()
  where id = p_session and status in ('requested', 'accepted', 'active');
  perform private.log_action('session_terminated', 'session', p_session::text, p_reason);
end;
$$;

-- Emergency stop: no one can go live, watch or join a session while it is on.
create function public.admin_set_emergency_stop(p_on boolean, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  update public.live_settings set emergency_stop = p_on, emergency_reason = p_reason,
    updated_by = (select auth.uid()), updated_at = now() where id = 1;
  if p_on then
    update public.live_streams set status = 'terminated', ended_at = now(), terminated_by = (select auth.uid()),
      termination_reason = coalesce('Emergency stop: ' || p_reason, 'Emergency stop')
    where status = 'live';
    update public.private_sessions set status = 'terminated', ended_at = now() where status = 'active';
  end if;
  perform private.log_action(case when p_on then 'emergency_stop_on' else 'emergency_stop_off' end, 'platform', null, p_reason);
end;
$$;

create function public.admin_resolve_report(p_report uuid, p_status text, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  if p_status not in ('actioned', 'dismissed') then raise exception 'Unknown status' using errcode = '22023'; end if;
  update public.live_reports set status = p_status, handled_by = (select auth.uid()), handled_at = now(),
    handling_note = p_note where id = p_report;
  perform private.log_action('report_' || p_status, 'report', p_report::text, p_note);
end;
$$;

create function public.admin_reply_ticket(p_ticket uuid, p_reply text, p_close boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  update public.creator_tickets set admin_reply = p_reply, replied_by = (select auth.uid()),
    status = case when p_close then 'closed' else 'answered' end, updated_at = now() where id = p_ticket;
  perform private.log_action('ticket_answered', 'ticket', p_ticket::text, null);
end;
$$;

create function public.admin_decide_appeal(p_appeal uuid, p_overturn boolean, p_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare who uuid;
begin
  perform private.require_role('admin');
  update public.creator_appeals set status = case when p_overturn then 'overturned' else 'upheld' end,
    decision_note = p_note, decided_by = (select auth.uid()), decided_at = now()
  where id = p_appeal and status = 'open' returning creator_id into who;
  if who is null then raise exception 'No open appeal' using errcode = '22023'; end if;
  if p_overturn then
    -- Back to verifying: approval still needs current checks.
    update public.creators set status = 'verifying', status_reason = 'Appeal overturned', updated_at = now()
    where user_id = who;
  end if;
  perform private.log_action(case when p_overturn then 'appeal_overturned' else 'appeal_upheld' end, 'creator', who::text, p_note);
end;
$$;

-- Admin reads (full rows, including revenue share and verification history).
create function public.admin_list_creators()
returns table (user_id uuid, stage_name text, country_code text, categories text[], status text,
               agreement_version text, revenue_share_pct numeric, identity_verified boolean, age_verified boolean,
               status_reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return query
    select c.user_id, c.stage_name, c.country_code, c.categories, c.status, c.agreement_version, c.revenue_share_pct,
           private.verified(c.user_id, 'identity'), private.verified(c.user_id, 'age'), c.status_reason, c.created_at
    from public.creators c order by c.created_at desc;
end;
$$;

create function public.admin_list_streams()
returns table (id uuid, creator_id uuid, stage_name text, title text, category text, explicit boolean, status text,
               room_name text, provider_key text, scheduled_at timestamptz, started_at timestamptz,
               participants uuid[], problems text[])
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return query
    select s.id, s.creator_id, c.stage_name, s.title, s.category, private.is_explicit(s.category), s.status,
           s.room_name, s.provider_key, s.scheduled_at, s.started_at, s.participants,
           private.broadcast_problems(s.id, s.creator_id)
    from public.live_streams s join public.creators c on c.user_id = s.creator_id
    where s.status in ('scheduled', 'live') or s.ended_at > now() - interval '7 days'
    order by (s.status = 'live') desc, coalesce(s.started_at, s.scheduled_at) desc;
end;
$$;

create function public.admin_list_reports()
returns setof public.live_reports
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return query select * from public.live_reports
    order by (status = 'open') desc, (priority = 'urgent') desc, created_at desc limit 500;
end;
$$;

create function public.admin_list_tickets()
returns setof public.creator_tickets
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return query select * from public.creator_tickets order by (status = 'open') desc, created_at desc limit 500;
end;
$$;

create function public.admin_list_appeals()
returns setof public.creator_appeals
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('admin');
  return query select * from public.creator_appeals order by (status = 'open') desc, created_at desc limit 500;
end;
$$;

create function public.admin_moderation_log(p_limit int default 200)
returns setof public.moderation_actions
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.require_role('moderator');
  return query select * from public.moderation_actions order by id desc limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_set_role(uuid, text, boolean)',
    'admin_upsert_provider(text, text, text, text, text, text[], text[], boolean, boolean, text, text, boolean, boolean, text, text)',
    'admin_list_providers()',
    'admin_set_country_policy(text, boolean, boolean, boolean, text, text)',
    'admin_set_agreement(text, text, text, boolean)',
    'admin_review_creator(uuid, text, text)',
    'admin_record_verification(uuid, text, text, text, text, text, boolean, timestamptz)',
    'admin_record_viewer_age(uuid, text, text, text, text, boolean)',
    'admin_set_revenue_share(uuid, numeric)',
    'live_terminate_stream(uuid, text)',
    'live_terminate_session(uuid, text)',
    'admin_set_emergency_stop(boolean, text)',
    'admin_resolve_report(uuid, text, text)',
    'admin_reply_ticket(uuid, text, boolean)',
    'admin_decide_appeal(uuid, boolean, text)',
    'admin_list_creators()',
    'admin_list_streams()',
    'admin_list_reports()',
    'admin_list_tickets()',
    'admin_list_appeals()',
    'admin_moderation_log(int)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
