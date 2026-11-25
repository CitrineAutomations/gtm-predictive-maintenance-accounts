-- Schema for the GTM account list. Run in the Supabase SQL editor.
-- One company tree: parent > business > plant. Safe to run more than once.
-- Writes come from the pipeline with the service_role key.
-- The web app reads with the anon key, read-only, through RLS.
-- The anon key can never read contacts.

begin;

-- Replace the v0 tables (parents, signals). Stops if they hold any rows.
do $$
declare
  has_rows boolean;
begin
  if to_regclass('public.parents') is null then
    return;
  end if;
  execute 'select exists (select 1 from public.parents)
               or exists (select 1 from public.signals)' into has_rows;
  if has_rows then
    raise exception 'v0 tables hold rows. Export or delete them, then run again.';
  end if;
  drop view if exists public.accounts_ranked;
  drop table public.signals;
  drop table public.parents;
end $$;

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  source_key text unique,              -- stable key from the pipeline, for upserts
  parent_id uuid references accounts(id) on delete restrict,  -- one level up
  root_id uuid not null references accounts(id) on delete restrict,  -- top owner, set by trigger
  level text not null check (level in ('parent', 'business', 'plant')),
  name text not null,
  domain text,
  industry_code text,                  -- NAICS
  industry_name text,
  city text,                           -- plants only
  state text,                          -- plants only
  is_target boolean not null default false,  -- takes one of the 250 places
  is_customer boolean,                 -- null means unknown
  link_source text check (link_source in ('epa', 'name_match', 'manual')),  -- name_match is unverified
  created_at timestamptz not null default now(),
  check (level <> 'parent' or parent_id is null),
  check (level <> 'plant' or parent_id is not null),
  check (level = 'plant' or (city is null and state is null)),
  check (not is_target or level = 'business'),
  check (parent_id is null or link_source is not null)
);

create index if not exists accounts_parent_id_idx on accounts(parent_id);
create index if not exists accounts_root_id_idx on accounts(root_id);

-- Sets root_id from the record above. Rejects plant parents and loops.
create or replace function accounts_set_root() returns trigger
language plpgsql set search_path = public as $$
declare
  above accounts%rowtype;
begin
  if new.parent_id is null then
    new.root_id := new.id;
    return new;
  end if;
  select * into above from accounts where id = new.parent_id;
  if above.level = 'plant' then
    raise exception 'a plant cannot sit above another record';
  end if;
  if exists (
    with recursive up as (
      select id, parent_id from accounts where id = new.parent_id
      union
      select a.id, a.parent_id from accounts a join up on a.id = up.parent_id
    )
    select 1 from up where id = new.id
  ) then
    raise exception 'parent_id would create a loop';
  end if;
  new.root_id := above.root_id;
  return new;
end $$;

-- When a record moves, the records below it get the new root_id.
create or replace function accounts_push_root() returns trigger
language plpgsql set search_path = public as $$
begin
  update accounts set root_id = new.root_id where parent_id = new.id;
  return null;
end $$;

drop trigger if exists accounts_set_root on accounts;
create trigger accounts_set_root before insert or update on accounts
  for each row execute function accounts_set_root();

drop trigger if exists accounts_push_root on accounts;
create trigger accounts_push_root after update on accounts
  for each row when (old.root_id is distinct from new.root_id)
  execute function accounts_push_root();

create table if not exists signals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  type text not null check (type in ('epa', 'osha', 'news', 'hiring')),
  observed_on date,
  source text,
  evidence text,                       -- the SDR quotes this
  deepline_run_id text,
  created_at timestamptz not null default now()
);

create index if not exists signals_account_id_idx on signals(account_id);

-- Real people. Private: service_role only.
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text,
  title text,
  buying_role text,
  source text,
  checked_on date,
  created_at timestamptz not null default now()
);

create index if not exists contacts_account_id_idx on contacts(account_id);

-- Roles to find at each level. No people. Public.
create table if not exists contact_roles (
  level text not null check (level in ('parent', 'business', 'plant')),
  role text not null,
  primary key (level, role)
);

insert into contact_roles (level, role) values
  ('parent', 'Head of procurement'),
  ('parent', 'Head of IT'),
  ('business', 'VP of operations'),
  ('business', 'IT director'),
  ('business', 'Procurement manager'),
  ('plant', 'Plant manager'),
  ('plant', 'Maintenance or reliability manager')
on conflict do nothing;

-- Roll up: each record with the totals of itself and everything below it.
create or replace view account_rollup
with (security_invoker = true) as
with recursive tree as (
  select id as account_id, id as node_id from accounts
  union all
  select t.account_id, a.id from tree t join accounts a on a.parent_id = t.node_id
),
plants as (
  select t.account_id, p.id, p.state, p.industry_name,
         exists (select 1 from signals s where s.account_id = p.id and s.type = 'epa') as has_epa,
         exists (select 1 from signals s where s.account_id = p.id and s.type = 'osha') as has_osha
  from tree t join accounts p on p.id = t.node_id and p.level = 'plant'
),
totals as (
  select account_id,
         count(*) as plant_count,
         count(distinct state) as state_count,
         count(*) filter (where has_epa) as epa_plant_count,
         count(*) filter (where has_osha) as osha_plant_count
  from plants group by account_id
),
-- Existing customer: yes if any record in the subtree is one,
-- no only if every record is a known non-customer, else unknown.
customers as (
  select t.account_id,
         case when bool_or(a.is_customer) then true
              when bool_and(a.is_customer is false) then false
         end as has_customer
  from tree t join accounts a on a.id = t.node_id
  group by t.account_id
),
-- The most common industry among the plants below each record.
industries as (
  select distinct on (account_id) account_id, industry_name, count(*) as n
  from plants where industry_name is not null
  group by account_id, industry_name
  order by account_id, count(*) desc, industry_name
)
select a.id, a.parent_id, a.root_id, a.level, a.name, a.domain,
       a.city, a.state, a.is_target, a.link_source,
       coalesce(t.plant_count, 0) as plant_count,
       coalesce(t.state_count, 0) as state_count,
       coalesce(t.epa_plant_count, 0) as epa_plant_count,
       coalesce(t.osha_plant_count, 0) as osha_plant_count,
       -- One industry when 60% or more of the plants share it, else Mixed.
       case when a.level = 'plant' then a.industry_name
            when i.n >= 0.6 * t.plant_count then i.industry_name
            when t.plant_count > 0 then 'Mixed'
       end as industry,
       c.has_customer
from accounts a
left join totals t on t.account_id = a.id
left join customers c on c.account_id = a.id
left join industries i on i.account_id = a.id;

-- The target list the web app reads. A target is a business with 3+ plants.
create or replace view target_accounts
with (security_invoker = true) as
select r.*, o.name as root_name
from account_rollup r
join accounts o on o.id = r.root_id
where r.is_target and r.plant_count >= 3;

-- Row-level security. No insert, update or delete policies exist,
-- so only the service_role key can change data.
alter table accounts enable row level security;
alter table signals enable row level security;
alter table contacts enable row level security;
alter table contact_roles enable row level security;

drop policy if exists "public read accounts" on accounts;
create policy "public read accounts" on accounts
  for select to anon using (true);

drop policy if exists "public read signals" on signals;
create policy "public read signals" on signals
  for select to anon using (true);

drop policy if exists "public read contact roles" on contact_roles;
create policy "public read contact roles" on contact_roles
  for select to anon using (true);

-- contacts has no policy. Also remove the table grants.
revoke all on contacts from anon, authenticated;

commit;
