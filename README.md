# GTM Project: 250 target accounts for a predictive-maintenance vendor

A GTM engineering case study. A predictive-maintenance platform sells to large manufacturers. The goal is a ranked list of 250 parent companies for an SDR team, shown in a lightweight CRM view.

The case: deals take about nine months and involve plant operations, IT and procurement. The best wins started at one plant and spread across the company. The CRM has about 4,000 accounts where plants, divisions and parents are mixed together, and the last list (every manufacturer over $1B) got almost no replies. The SDR team can work 250 accounts well.

The approach is in [docs/approach.md](docs/approach.md).

## Status

v0. Built from public data only. There is no access to the vendor's Salesforce data, so:

- No customer flags. Existing customer plants are not marked.
- Account scoring uses public signals, not won/lost history.
- Plant-to-parent matching depends on the EPA TRI files, which cover only plants that report to TRI.

## Results so far

Contact enrichment ran on 250 parent companies on 2026-11-26. The demo uses the companies with at least one valid email.

| Result | Companies |
| --- | --- |
| At least one valid email | 108 |
| A person, but no valid email | 56 |
| No person found | 86 |
| Total | 250 |

- The search picked 216 people at 164 companies. 130 of them have a valid email.
- The CRM holds the 108 companies and 130 contacts. It runs locally and is not deployed.
- Spend for the whole project so far: 75.32 Deepline credits (60.32 of them on email lookups) and 0.357 USD on Exa. The contact searches used the free allowance. See `docs/credit_ledger.csv`.

Limits:

- No person has reviewed the full contact list. A valid email does not prove that the person still works at that plant.
- Contact names come from a search database that can be out of date. Some people are in the same state as the start plant but not the same city.
- No outreach has been sent.

## Layout

| Folder | Purpose |
| --- | --- |
| `docs/` | Approach, assumptions, and the 60-day test plan |
| `pipeline/` | Deepline steps that build the account list |
| `data/raw/` | Third-party downloads (not committed) |
| `data/processed/` | Intermediate pipeline output (CSV) |
| `supabase/` | Database schema and row-level security |
| `web/` | Lightweight CRM view. The app is on branch `agent/crm-app-1124c` and runs locally |

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

To follow a contact search run, use `node pipeline/progress_contacts.mjs`. It updates every 2 seconds. Add `--once` to print it one time.

Email lookup is a paid Deepline play (`prebuilt/person-to-email-batch`). Run it with a dry run and `--max-credits`, and log it in `docs/credit_ledger.csv`.

Names, emails and phone numbers stay in `data/contacts/`, which Git ignores. The plant check results and the files built from them are kept local too and are not committed.

## Flow

1. Build the plant and parent universe from public registries.
2. Pull signals for each parent (hiring, expansion, plant count).
3. Score and rank the parents.
4. Check each start plant for a closure, sale or serious incident.
5. Pick contacts and look up their emails.
6. Load the demo accounts and contacts into the local CRM database.

A hosted Supabase copy of the CRM database is planned and not built. `supabase/schema.sql` is the starting schema.

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
