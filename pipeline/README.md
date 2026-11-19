# Pipeline

Each step reads from the step before it and writes to `data/`. Run steps in order. Use a dry run before any paid Deepline call.

| Step | Input | Output | Deepline tool |
| --- | --- | --- | --- |
| 01 universe | EPA TRI Basic Data Files (RY2024), run with `node pipeline/01_universe.mjs 2024 ALL` | `data/processed/tri_shortlist_parents.csv`, `tri_summary.json`, `tri_facilities.csv` (ignored) | none (public EPA download) |
| 02b echo | `tri_shortlist_facilities.csv`, run with `node pipeline/02b_echo.mjs` | `data/processed/echo_parents.csv`, `echo_summary.json` | none (public EPA ECHO download, about 450 MB) |
| 02c osha | `tri_shortlist_facilities.csv`, run with `node pipeline/02c_osha.mjs` | `data/processed/osha_parents.csv`, `osha_summary.json` | none (OSHA data from a public mirror) |
| 02d news | `tri_shortlist_parents.csv`, run with `node pipeline/02d_news.mjs sample` or `all` | `data/processed/news_signals.csv`, `news_summary.json` | none (Exa web search, billed to the key owner) |
| 02e maps test | 25 sampled parents, run with `node pipeline/02e_maps_test.mjs plan`, then the loop below, then `analyze` | `data/processed/maps_test_*.csv`, `maps_test_summary.json` | `serper_google_maps_search` (0.04 credits per result) |
| 02f maps by state | `tri_shortlist_facilities.csv`, run `node pipeline/02f_maps_states.mjs plan`, then the loop below (read `queries.tsv` from `data/raw/maps_states/`), then `analyze` | `data/processed/maps_states_*.csv`, `maps_states_summary.json` | `serper_google_maps_search` (0.04 credits per query) |
| 02 signals | `parents.csv` | `data/processed/signals.csv` | `prebuilt/company-to-job-postings-batch` |
| 03 segments | `echo_parents.csv`, `osha_parents.csv` | `data/processed/segments.csv`, `segments_summary.json` | none |
| 04 titles | top parents | `data/contacts/titles.csv` | `company_titles` |
| 05 load | `scored.csv`, `signals.csv` | Supabase `parents` and `signals` tables | none (Supabase service_role key) |

## Open items

- Step 01 is verified. The TRI file `mv_tri_basic_download` has parent name, FRS ID and primary NAICS. The latest year is 2024.
- Step 02 pilot ran on 24 parents (OH, TX shortlist industries). It cost 13.44 credits (24 x 0.56). The play returns at most 25 postings per company plus a total count, so title counts are a lower bound. Domains marked "general knowledge" in `pilot_parents.csv` were not verified by a data source.
- Step 01 now runs for all states. It keeps 978 parents with 3 or more plants in the shortlist industries (RY2024). Parent names are not merged across spelling variants yet.
- Pilot step 02 on 25 parents first (about 15 credits).
- Segments are angles for outreach, not one weighted score. Write the segment rules in `docs/approach.md`.
- The OSHA data comes from a third-party mirror (labordata.bunkum.us). Only 1,182 inspections matched a shortlist plant by name and place. Check a sample before the Loom.
- The hiring segment covers 24 parents only. Run step 02 on the segments that need it.

## Maps test loop

Run after `plan`. The file has no final newline, so the loop uses `|| [ -n "$i" ]`.

```bash
while IFS=

- Record the Deepline run ID next to each output.
- Log every paid call in `docs/credit_ledger.csv`. Use `node pipeline/ledger.mjs add ...` and check `node pipeline/ledger.mjs report`. The report compares the ledger with the Deepline balance.
- Never overwrite a raw file. Write derived files to `data/processed/`.
	' read -r i parent query || [ -n "$i" ]; do
  q=$(printf '%s' "$query" | sed 's/"/ /g')
  deepline run serper_google_maps_search --input "{\"query\":\"$q\"}" --json-out "data/raw/maps/$i.json" > /dev/null
done < data/raw/maps/queries.tsv
```

## Rules

- Record the Deepline run ID next to each output.
- Never overwrite a raw file. Write derived files to `data/processed/`.
