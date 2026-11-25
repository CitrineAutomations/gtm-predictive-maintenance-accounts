# GTM Project: 250 target accounts for a predictive-maintenance vendor

A GTM engineering case study. A predictive-maintenance platform sells to large manufacturers. The goal is a list of 250 target businesses for an SDR team, shown in a lightweight CRM view.

The case: deals take about nine months and involve plant operations, IT and procurement. The best wins started at one plant and spread across the company. The CRM has about 4,000 accounts where plants, divisions and parents are mixed together, and the last list (every manufacturer over $1B) got almost no replies. The SDR team can work 250 accounts well.

The approach is in [docs/approach.md](docs/approach.md). It was written before the data model below and still says to rank parent companies.

## Status

v0. Built from public data only. There is no access to the vendor's Salesforce data, so:

- No customer flags. Every account's customer status is unknown.
- Account selection uses public signals, not won/lost history. There is no single score or rank, and the rule that picks the 250 from the signals is not written yet.
- Plant-to-owner matching starts from the EPA TRI files, which cover only plants that report to TRI. TRI names the plant and the top owner. Businesses between them come from name matching and stay unverified until someone checks them.

The database schema is in this repo. The load step and the web app are not built.

## Data model

Accounts form one company tree, and every record leads back to its top owner.

| Level | What it is | Example | Takes one of the 250 places |
| --- | --- | --- | --- |
| Parent | The top owner | Berkshire Hathaway | No |
| Business | A company that runs plants. It can sit under another business. | Lubrizol | Yes, with 3 or more plants |
| Plant | One factory at one address | A Lubrizol plant in Deer Park, TX | No |

The Berkshire example comes from plant names and general knowledge. No owner link in it is verified.

| Table or view | Holds | `anon` key |
| --- | --- | --- |
| `accounts` | The tree: `parent_id`, `root_id`, `level`, `is_target`, `is_customer`, `link_source` | Read |
| `signals` | EPA, OSHA, news and hiring evidence on any account | Read |
| `contacts` | Real people: name, title, buying role, source, date checked | No access |
| `contact_roles` | Roles to find at each level, with no people | Read |
| `account_rollup` | Each account with the totals of the plants below it | Read |
| `target_accounts` | Targets with 3 or more plants | Read |

How the views roll up:

- A parent or business shows plant, state, EPA and OSHA totals from every plant below it.
- It shows one industry when 60% or more of its plants share it, and "Mixed" otherwise.
- It counts as a customer if any record below it is one, and as not a customer only when all of them are known not to be.

The schema does not cap targets at 250. The pipeline has to set `is_target` on no more than that.

## Layout

| Folder | Purpose |
| --- | --- |
| `docs/` | Approach, assumptions, and the 60-day test plan |
| `pipeline/` | Deepline steps that build the account list |
| `data/raw/` | Third-party downloads (not committed) |
| `data/processed/` | Intermediate pipeline output (CSV) |
| `supabase/` | Database schema and row-level security |
| `web/` | Lightweight CRM view, deployed on Vercel |

## Flow

1. Build the plant and parent universe from public registries.
2. Group plants into businesses under their parent.
3. Pull signals (EPA, OSHA, news, hiring).
4. Mark up to 250 businesses as targets.
5. Upsert accounts and signals into Supabase, matching accounts on `source_key`.
6. The web app reads `target_accounts`, `account_rollup`, `signals` and `contact_roles`.

## Requirements

- Node 22 or later
- Deepline CLI (`npm install -g deepline`), signed in with `deepline setup`
- A Supabase project. Run `supabase/schema.sql` in the SQL editor. It replaces the earlier `parents` and `signals` tables, and stops without changes if they hold rows.
- GitHub CLI and Vercel CLI for publishing

## Data rules

- Keep Deepline and Supabase keys in `.env` (see `.env.example`). Do not commit them.
- The Supabase `service_role` key stays on the server and in local `.env`. The browser uses only the `anon` key, with row-level security on.
- Do not commit personal contact data. Keep it in `data/contacts/`, which is ignored.
- The web app shows contact roles, not people. The `anon` key cannot read the `contacts` table.
- Check the price of every Deepline run with a dry run before a paid run.
