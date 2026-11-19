-- Schema for the GTM account list. Run in the Supabase SQL editor.
-- Writes come from the pipeline with the service_role key.
-- The public web app reads with the anon key, read-only, through RLS.

create table if not exists parents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text unique,
  naics text,
  plant_count integer,
  has_customer_plant boolean,          -- null means unknown (no CRM access in v0)
  score numeric,
  rank integer,
  why text,                            -- one-line reason this account ranks here
  first_contact_role text,
  created_at timestamptz not null default now()
);

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents(id) on delete cascade,
  type text not null,                  -- for example: hiring, expansion
  observed_on date,
  source text,
  evidence text,
  deepline_run_id text,
  created_at timestamptz not null default now()
);

create index if not exists signals_parent_id_idx on signals(parent_id);
create index if not exists parents_rank_idx on parents(rank);

-- The view the web app reads: the ranked top 250.
create or replace view accounts_ranked
with (security_invoker = true) as
select id, name, domain, naics, plant_count, has_customer_plant,
       score, rank, why, first_contact_role
from parents
where rank is not null and rank <= 250
order by rank;

-- Row-level security. No insert, update or delete policies exist,
-- so only the service_role key can change data.
alter table parents enable row level security;
alter table signals enable row level security;

create policy "public read parents" on parents
  for select to anon using (true);

create policy "public read signals" on signals
  for select to anon using (true);
