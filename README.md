# 250 target accounts for a predictive-maintenance vendor

A GTM engineering case study built from public data.

A predictive-maintenance platform sells to large manufacturers. Deals take about nine months and involve plant operations, IT and procurement. The best wins started at one plant and spread across the company. The CRM holds about 4,000 accounts where plants, divisions and parents are mixed together, and the last list (every manufacturer over $1B) got almost no replies. The SDR team can work 250 accounts well.

This repo answers with a list of 250 parent companies, a small CRM to work them from, and a way to test whether the signal behind the list does anything.

We had no access to the vendor's CRM. Everything about customers, deal history and what predicts a sale is unknown, and the choices below are hypotheses.

## How the 250 are picked

One account is one parent company. Its businesses and plants sit underneath it.

| Step | Rule | Companies left |
| --- | --- | --- |
| Universe | Parents with 3 or more plants in asset-heavy industries (food, petroleum, chemicals, plastics and rubber, metals, machinery, transportation equipment), from the EPA Toxics Release Inventory, 2024 | 978 |
| Signal | At least one plant with a serious, repeat or willful OSHA citation since 2023-11-01 | 392 |
| Room to spread | Plants in 2 or more states | 373 |
| Top 250 | Ordered by plants with machine-related citations | 250 |

"Machine-related" means lockout and tagout (29 CFR 1910.147), machine guarding (1910.212), power transmission guarding (1910.219) or mechanical integrity (1910.119(j)). 244 of the 250 have one, and 14 have a mechanical integrity citation. A citation does not prove that equipment failed.

## Signals we kept and signals we dropped

| Signal | What we did with it |
| --- | --- |
| Plants per parent, states | Gate |
| OSHA citations | Gate, ordering and the outreach angle being tested |
| EPA equipment violations | Background on the battle card only |
| EPA "any non-compliance" count | Dropped. See below |
| Revenue alone | Ignored. The list that used it failed |
| Hiring and company news | Researched by hand for one account so far |

## The 60-day test

Each account is in one group. 201 accounts get an email with an equipment angle chosen because of the OSHA signal. 49 accounts get the same email without it. The first and last lines are identical, so only the middle differs. Assignment is random within three size groups (3 to 4, 5 to 9, and 10 or more plants), because larger companies pick up more citations.

An SDR logs one result for each account: no reply, reply or meeting booked. With groups this size the test shows a direction, not proof.

## The CRM

[`web/`](web/) is a local app built on parts of [NextCRM](https://github.com/pdovhomilja/nextcrm-app) (MIT). It has:

- the 250 accounts with filters
- a battle card for each account: start plant, who to contact, the inspection record, EPA background, the email and what not to say
- a company tree from parent to plant
- result logging and a view of the two test groups

It is not deployed. Setup is in [web/README.md](web/README.md).

## EPA: what we tried and what we found

**First idea.** Treat a plant with 4 or more quarters of non-compliance in the last 12 as a sales signal, using the "ECHO exporter" file from EPA's [Enforcement and Compliance History Online](https://echo.epa.gov/) ([`pipeline/02b_echo.mjs`](pipeline/02b_echo.mjs)). 606 of the 978 parents had at least one such plant.

**Why we dropped that measure.**

- We read the records behind the flag for three plants of one company. They were a missed annual certification, a permit status item and hazardous waste items. None showed an equipment failure.
- The facility field `FAC_QTRS_WITH_NC` does not always equal the highest program field. Across 7,458 plants it is equal for 6,702, lower for 333 and higher for 423. We do not know why.

**What we use now.** [`pipeline/02g_epa_detail.mjs`](pipeline/02g_epa_detail.mjs) reads EPA's bulk water, waste and air files (about 3.4 GB) for the 3,061 plants of the 250 accounts. It keeps violation types that relate to equipment: discharges above a permit limit, bypasses and spills, hazardous waste rules for leaks and tanks, and air High Priority Violations (counted apart). It counts violations since 2023-11-01, plus older leak, tank and air items that have no end date. Late reports and paperwork do not count.

| Result | Plants | Accounts (of 250) |
| --- | --- | --- |
| Equipment-related violation (not counting air High Priority) | 388 | 136 |
| EPA serious violator mark now | 226 | 114 |
| Open leak, tank or air High Priority item | 50 | 36 |
| Discharge breach under a stormwater permit only (not a flag) | 31 | 24 |

**Checks.** We compared two plants of one company with EPA's facility report pages. The violations we listed were there, and one page showed more history than we count. That comparison was made before we added the open-item, serious violator and stormwater rules.

**Limits.** The link between a violation and equipment is our assumption. The stormwater rule only sees permits tagged as industrial or construction stormwater. "Open" means EPA's file has no return-to-compliance date, so the plant may have fixed the problem. The signal shows up more often at companies with more plants.

## Known limits

- The universe only covers plants that report to the Toxics Release Inventory.
- OSHA data comes from a third-party copy ([labordata.bunkum.us](https://labordata.bunkum.us)). We compared one company's two inspections with the official Department of Labor data service. They matched apart from one dollar of rounding. The rest are unchecked.
- Plants are matched to OSHA records by name and place. We found and fixed false matches on shared town names, and others may remain.
- Parent names come from EPA filings. They can be out of date, and spelling variants are not all merged.
- Ownership splits under holding companies rest partly on plant names.
- Nothing here has been tested against sales results.

## Layout

| Folder | Purpose |
| --- | --- |
| [`pipeline/`](pipeline/) | Scripts that build the list. See [pipeline/README.md](pipeline/README.md) |
| `data/processed/` | Pipeline output. Plant-level files are regenerated, not committed |
| `data/raw/` | Third-party downloads, not committed |
| [`web/`](web/) | The CRM (Next.js, Prisma, Postgres, Better Auth) |
| [`docs/`](docs/) | [approach.md](docs/approach.md) is an early draft written before the data work. Where it differs from this page, this page is current. [credit_ledger.csv](docs/credit_ledger.csv) logs paid and metered calls |
| [`supabase/`](supabase/) | An earlier schema. The CRM does not use it |

## Rebuilding the list

Needs Node 22 or later and `unzip`. Run from the repo root.

```bash
node pipeline/01_universe.mjs 2024 ALL
node pipeline/02b_echo.mjs
node pipeline/02c_osha.mjs
node pipeline/03_segments.mjs
node pipeline/03b_select.mjs
node pipeline/02g_epa_detail.mjs   # after downloading EPA's bulk zips, listed in the script
```

These steps use public data and spend no credits. The other scripts in `pipeline/` are experiments, and some of them call paid services. These steps have not been rerun from a clean clone.

## Data rules

- No keys in Git. Copy `.env.example` for the names.
- No personal contact data in Git. Contacts load into the CRM from a local file.
- Check the price of a paid run before running it, and log it in the ledger.
