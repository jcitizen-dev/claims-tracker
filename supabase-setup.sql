-- ============================================================================
-- Claims Tracker — database setup
-- Paste this whole file into the Supabase SQL Editor and hit Run.
-- It is safe to run more than once.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- One table holds both boards. `board` decides which tab a row shows up on,
-- so Collections already has every Subrogations column -- they are just hidden
-- in the UI until you switch them on.
-- ---------------------------------------------------------------------------
create table if not exists public.claims (
  id            uuid primary key default gen_random_uuid(),
  board         text not null check (board in ('subrogation', 'collection')),
  car_num       text,
  amount        numeric(12,2),
  date_of_loss  text,
  claim_num     text,
  date_received text,
  customer_name text,
  stage         text,
  status        text,
  vin           text,
  contract      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists claims_board_idx on public.claims (board);

-- Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists claims_touch on public.claims;
create trigger claims_touch
  before update on public.claims
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security.
-- The anon key that ships in the published site grants NOTHING on its own --
-- every read and write requires a signed-in user. This is what makes it safe
-- for the site's source to be public while the customer data is not.
-- ---------------------------------------------------------------------------
alter table public.claims enable row level security;

drop policy if exists claims_all_authenticated on public.claims;
create policy claims_all_authenticated on public.claims
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Live updates between browsers (so edits show up on a colleague's screen).
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.claims;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

alter table public.claims replica identity full;

-- ---------------------------------------------------------------------------
-- Starting data lives in seed-data.sql, which is deliberately NOT in this
-- repository -- it contains real customer names, VINs and claim numbers, and
-- this repo is public. Run that file once, separately, in the SQL Editor.
-- ---------------------------------------------------------------------------
