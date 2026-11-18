# Pipeline

Each step reads from the step before it and writes to `data/`. Run steps in order. Use a dry run before any paid Deepline call.

| Step | Input | Output | Deepline tool |
| --- | --- | --- | --- |
| 01 universe | EPA FRS and TRI files | `data/processed/parents.csv` | `generic_http`, `free_simple_company_search` |
| 02 signals | `parents.csv` | `data/processed/signals.csv` | `prebuilt/company-to-job-postings-batch` |
| 03 score | `signals.csv` | `data/processed/scored.csv` | deepline-scoring |
| 04 titles | top parents | `data/contacts/titles.csv` | `company_titles` |
| 05 export | `scored.csv` | `data/processed/accounts.json` | none |

## Open items

- Confirm the current EPA FRS and TRI file names and parent-company fields before step 01.
- Pilot step 02 on 25 parents first (about 15 credits).
- Pick the score weights and write them in `docs/approach.md`.

## Rules

- Record the Deepline run ID next to each output.
- Never overwrite a raw file. Write derived files to `data/processed/`.
