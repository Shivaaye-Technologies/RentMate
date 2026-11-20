-- Minimal stand-ins for the Supabase platform pieces the migrations use, so they
-- can run in a throwaway local Postgres (PGlite) for tests. NOT for production.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema auth;
create table auth.users (
  instance_id uuid, id uuid primary key, aud varchar, role varchar, email varchar,
  encrypted_password varchar, email_confirmed_at timestamptz, invited_at timestamptz,
  confirmation_token varchar, confirmation_sent_at timestamptz, recovery_token varchar,
  recovery_sent_at timestamptz, email_change_token_new varchar, email_change varchar,
  email_change_sent_at timestamptz, last_sign_in_at timestamptz, raw_app_meta_data jsonb,
  raw_user_meta_data jsonb, is_super_admin boolean, created_at timestamptz, updated_at timestamptz,
  phone text, phone_confirmed_at timestamptz, phone_change text default '',
  phone_change_token varchar default '', confirmed_at timestamptz,
  email_change_token_current varchar default '', email_change_confirm_status smallint default 0,
  banned_until timestamptz, reauthentication_token varchar default '',
  is_sso_user boolean not null default false, deleted_at timestamptz,
  is_anonymous boolean not null default false
);
create function auth.uid() returns uuid language sql stable as $$
  -- Like Supabase's own auth.uid(): an empty claims setting (left behind after a transaction-local set) means no user.
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid;
$$;
-- Supabase Auth: the JWT claims (aal = assurance level), MFA factors and sessions.
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text, factor_type text not null default 'totp', status text not null default 'unverified',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table auth.sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz default now(), aal text, not_after timestamptz
);
grant usage on schema auth to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

create publication supabase_realtime;

-- Supabase grants the API roles access to new objects in public by default.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
