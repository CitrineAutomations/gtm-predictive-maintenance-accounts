# GTM Project: 250 target accounts for a predictive-maintenance vendor

A GTM engineering case study. A predictive-maintenance platform sells to large manufacturers. The goal is a ranked list of 250 parent companies for an SDR team, shown in a lightweight CRM view.

The case: deals take about nine months and involve plant operations, IT and procurement. The best wins started at one plant and spread across the company. The CRM has about 4,000 accounts where plants, divisions and parents are mixed together, and the last list (every manufacturer over $1B) got almost no replies. The SDR team can work 250 accounts well.

The approach is in [docs/approach.md](docs/approach.md).

## Status

v0. Built from public data only. There is no access to the vendor's Salesforce data, so:

- No customer flags. Existing customer plants are not marked.
- Account scoring uses public signals, not won/lost history.
- Plant-to-parent matching depends on the EPA TRI files, which cover only plants that report to TRI.

## EPA report: what we did and what we found

**Source.** The bulk "ECHO exporter" file from EPA's [Enforcement and Compliance History Online](https://echo.epa.gov/), downloaded 2026-11-18. Step `pipeline/02b_echo.mjs` joins it to our plants by EPA registry ID and found 7,458 of 7,486 plants that have an ID.

**First idea.** Treat a plant with 4 or more quarters of non-compliance in the last 12 as a sales signal. 606 of 978 parent companies had at least one such plant.

**What the records showed.** We read the records behind the flag for three Lubrizol plants. They were a missed annual certification, a permit status item and hazardous waste items. None showed an equipment failure. An email that claimed one would have been wrong.

**Decision.**

- EPA is not an outreach angle.
- The 250 accounts are picked on OSHA citations. 187 of them also have the EPA flag.
- The 60-day test compares the OSHA email with an email that uses no signal.
- Each battle card still shows the start plant's quarter count and a link to the EPA Detailed Facility Report, as background to read before a call.

**Check on 2026-11-25.** For the start plants of the top 25 accounts, we compared our quarter count with EPA's data service. 22 matched and 3 differed. One of the 3 moved from below the threshold to above it. The likely cause is that EPA updated its data after our download, but we did not confirm that. The facility report link for one account loaded.

**Limits.**

- The count is the field `FAC_QTRS_WITH_NC`. We did not check its definition in EPA's data dictionary.
- The card does not say which program (air, water or waste) the quarters come from.
- We read the underlying records for three plants only.

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
