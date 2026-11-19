# Pipeline

Each step reads from the step before it and writes to `data/`. Run steps in order. Use a dry run before any paid Deepline call.

| Step | Input | Output | Deepline tool |
| --- | --- | --- | --- |
| 01 universe | EPA TRI Basic Data Files (RY2024), run with `node pipeline/01_universe.mjs 2024 OH TX` | `data/processed/pilot_facilities.csv`, `pilot_summary.json` | none (public EPA download) |
| 02 signals | `parents.csv` | `data/processed/signals.csv` | `prebuilt/company-to-job-postings-batch` |
| 03 score | `signals.csv` | `data/processed/scored.csv` | deepline-scoring |
| 04 titles | top parents | `data/contacts/titles.csv` | `company_titles` |
| 05 load | `scored.csv`, `signals.csv` | Supabase `parents` and `signals` tables | none (Supabase service_role key) |

## Open items

- Step 01 is verified. The TRI file `mv_tri_basic_download` has parent name, FRS ID and primary NAICS. The latest year is 2024.
- Step 02 pilot ran on 24 parents (OH, TX shortlist industries). It cost 13.44 credits (24 x 0.56). The play returns at most 25 postings per company plus a total count, so title counts are a lower bound. Domains marked "general knowledge" in `pilot_parents.csv` were not verified by a data source.
- Plant counts only cover the states pulled. Run all states before ranking by plant count.
- Pilot step 02 on 25 parents first (about 15 credits).
- Pick the score weights and write them in `docs/approach.md`.

## Rules

- Record the Deepline run ID next to each output.
- Never overwrite a raw file. Write derived files to `data/processed/`.
