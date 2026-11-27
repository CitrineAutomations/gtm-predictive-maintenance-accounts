# GTM Project: 250 target accounts for a predictive-maintenance vendor

A GTM engineering case study. A predictive-maintenance platform sells to large manufacturers. The goal is a ranked list of 250 parent companies for an SDR team, shown in a lightweight CRM view.

The case: deals take about nine months and involve plant operations, IT and procurement. The best wins started at one plant and spread across the company. The CRM has about 4,000 accounts where plants, divisions and parents are mixed together, and the last list (every manufacturer over $1B) got almost no replies. The SDR team can work 250 accounts well.

The approach is in [docs/approach.md](docs/approach.md).

## Status

v0. Built from public data only. There is no access to the vendor's Salesforce data, so:

- No customer flags. Existing customer plants are not marked.
- Account scoring uses public signals, not won/lost history.
- Plant-to-parent matching depends on the EPA TRI files, which cover only plants that report to TRI.

## Layout

| Folder | Purpose |
| --- | --- |
| `docs/` | Approach, assumptions, and the 60-day test plan |
| `pipeline/` | Deepline steps that build the account list |
| `data/raw/` | Third-party downloads (not committed) |
| `data/processed/` | Intermediate pipeline output (CSV) |
| `supabase/` | Database schema and row-level security |
| `web/` | Lightweight CRM view, deployed on Vercel |

## Plant check and contacts

These steps run after step 03b. Run each from the repo root. `PIPELINE_DIR` points steps 04a to 04e at the folder that holds the ignored inputs from earlier steps.

| Script | What it does | Cost |
| --- | --- | --- |
| `04a_research.mjs` | Company facts and recent news for one account | Keenable free allowance, Exa as a fallback |
| `04b_people_search.mjs` | Web search for plant leaders at a few companies | Keenable free allowance |
| `04c` to `04e` | Check each candidate start plant for a closure, sale or serious incident | Keenable free allowance |
| `05_contact_list.mjs` | Apply the drop, hold and replace decisions to the account list | None |
| `04f_contact_search.mjs` | Pick one plant and one maintenance person per company | Deepline free search allowance |
| `06_demo_accounts.mjs` | Build the files the CRM loads | None |
| `progress_contacts.mjs` | Progress view for contact enrichment | None |

Email lookup is a paid Deepline play (`prebuilt/person-to-email-batch`). Run it with a dry run and `--max-credits`, and log it in `docs/credit_ledger.csv`.

Names, emails and phone numbers stay in `data/contacts/`, which Git ignores. The plant check results and the files built from them are kept local too and are not committed.

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
