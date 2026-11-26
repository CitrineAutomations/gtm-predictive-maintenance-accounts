# GTM Project: 250 target accounts for a predictive-maintenance vendor

A GTM engineering case study. A predictive-maintenance platform sells to large manufacturers. The goal is a ranked list of 250 parent companies for an SDR team, shown in a lightweight CRM view.

The case: deals take about nine months and involve plant operations, IT and procurement. The best wins started at one plant and spread across the company. The CRM has about 4,000 accounts where plants, divisions and parents are mixed together, and the last list (every manufacturer over $1B) got almost no replies. The SDR team can work 250 accounts well.

The approach is in [docs/approach.md](docs/approach.md).

## Status

v0. Built from public data only. There is no access to the vendor's Salesforce data, so:

- No customer flags. Existing customer plants are not marked.
- Account scoring uses public signals, not won/lost history.
- Plant-to-parent matching depends on the EPA TRI files, which cover only plants that report to TRI.

## Contact enrichment

The plan for finding contacts is in [docs/contact_enrichment.md](docs/contact_enrichment.md). It is a draft and has not run on the 250 accounts.

1. Search for company facts with Keenable. Exa is a fallback when Keenable leaves a gap.
2. Search for recent news the same way.
3. Use both to choose the plant, domain and job titles to search.
4. Search for contacts with Deepline.

Contacts and research go in the CRM database first, to be mirrored into Supabase later. The Flow section below describes the Supabase side. Contact data is never committed.

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
2. Pull signals for each parent (hiring, expansion, plant count).
3. Score and rank the parents.
4. Find the first contact role for each top account.
5. Upsert the result into Supabase (`parents` and `signals` tables).
6. The web app reads the `accounts_ranked` view and shows the table.

## Requirements

- Node 22 or later
- Deepline CLI (`npm install -g deepline`), signed in with `deepline setup`
- A Supabase project. Run `supabase/schema.sql` in the SQL editor.
- GitHub CLI and Vercel CLI for publishing

## Data rules

- Keep Deepline and Supabase keys in `.env` (see `.env.example`). Do not commit them.
- The Supabase `service_role` key stays on the server and in local `.env`. The browser uses only the `anon` key, with row-level security on.
- Do not commit personal contact data. Keep it in `data/contacts/`, which is ignored.
- Check the price of every Deepline run with a dry run before a paid run.
