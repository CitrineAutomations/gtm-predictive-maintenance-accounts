# Contact enrichment plan

Status: draft, 2026-11-26. Nothing here has run on the 250 accounts yet.

Several files named here are not on `main` yet. The pipeline scripts (including the EPA equipment step, 02g), `accounts_250.csv` and the credit ledger are on `agent/pilot-universe-0818b`. The CRM (`web/`) is on `agent/crm-app-1124c`. The battle card spec is on `agent/battle-card-spec-1124a`.

For each account we research the company, research recent news, then use both to decide who to look for. The contact search comes last because the research can change which plant, domain and job titles are right. In the Polynt test, news showed that one plant had closed, and a job posting named the site role that the maintenance manager reports to.

## Before we start

| # | Task | Done when |
| --- | --- | --- |
| 1 | Check the EPA equipment files from step 02g. They are committed. | A sample of violations from the current rules matches EPA's own pages |
| 2 | Merge the account list into `main` | `accounts_250.csv`, `ledger.mjs` and `credit_ledger.csv` are on `main` |
| 3 | Decide whether EPA results change the start plant. They do not change the email groups. | The rule is written down before any contact search |
| 4 | Store contacts and research in the CRM database (decided 2026-11-25) | The CRM load step reads the contact file and the research file for the pilot accounts |
| 5 | Review the accounts that have a `review_note` (34) | Each is kept, changed or replaced |
| 6 | Write the research step (`pipeline/04a_research.mjs`), with Keenable first and the Exa fallback | It runs on one account, writes the output below and records which questions needed Exa |
| 7 | Write the contact step (`pipeline/04b_contacts.mjs`) | It reads the search brief and writes the contact file |

`accounts_250.csv` has no website domain column. Step 1 of the process fills that gap, and no contact search runs for an account without a checked domain.

## The process

Keenable is the search tool for steps 1 and 2. Exa is a fallback for the accounts where Keenable leaves a gap.

### When to use Exa

Results alone are not enough. After the Keenable searches, check that they answer these:

1. Does the company still own and run the start plant?
2. What is the correct website domain?
3. Is there a recent sale, closure or acquisition?
4. Which maintenance job titles does the company use?

Run Exa only if question 1, 2 or 3 has no answer. "We found no sale or closure" counts as an answer to question 3 when the Keenable searches asked for both and returned pages about this company. A missing answer to question 4 does not need Exa and does not hold the account. Use the default titles.

If Exa leaves question 1 or 2 open, set `Hold` in the search brief.

### Step 1. Company search (Keenable)

Find:

- what the company makes
- who owns it, and any recent change of owner
- the website domain for the parent, and for each business that uses its own
- which plants on our list the company still runs
- the names of its business units

Prefer the company's own site and filings. Note the date of any old document.

### Step 2. News search (Keenable)

Look back 12 months for:

- plant closures, sales and layoffs
- acquisitions and ownership changes
- expansions and new lines
- job postings for maintenance, reliability and plant engineering
- any maintenance or monitoring tool the company already uses
- news about the start plant and other signal plants

Rules, most of them learned in earlier tests:

- Drop `linkedin.com/in/` results. They describe named people.
- Keep a result only if it is clearly about this company.
- Read the page before using it. A search date can be wrong, and a posting date can be a repost.
- Mark a fact that rests on one source.

### Step 3. Search brief

Turn the research into instructions for the contact search. One brief per account:

| Field | How the research sets it |
| --- | --- |
| Start plant | The current start plant, unless it is closed or sold. Then the next signal plant. |
| Backup plant | The next open signal plant |
| Domains | Parent or business domain, whichever staff at the start plant use |
| Titles | The default list, plus titles the company uses in its own postings |
| Exclude | Closed plants, sold businesses, former company names that now belong to someone else |
| Hold | A reason to stop and ask a person, such as a pending sale, bankruptcy or no open plant |
| Evidence | A source link and date for each change from the default |

Default titles:

- Plant: Plant Manager, Site Director, Site Manager
- Maintenance: Maintenance Manager, Maintenance Superintendent, Reliability Manager

IT and procurement come after the plant team shows interest, so we do not search for them in this round.

### Step 4. Contact search (Deepline)

1. Search by domain, titles and country with `search_contact`.
2. If nothing comes back, try the business domain, then the company name. Record what was tried.
3. Pick 2 contacts per account, one plant and one maintenance (decided 2026-11-26, enough for the demo). Prefer the same city as the start plant, then the same state.
4. Look up email with `prebuilt/person-to-email-batch`, only for the people picked.
5. Flag a contact whose last name or mailbox is the company's own name, or who sits at a closed plant.
6. Leave the role empty if no one fits. Do not fill it with a weaker title without saying so.

### Step 5. Check and load

- A person confirms that each contact still works there and covers the start plant.
- Only a `valid` email counts as ready to send. `catch_all` and blank statuses are marked "Not confirmed".
- Load contacts into the CRM, and update the account's "About the company" and "Recent news" sections.

## Outputs

| Output | Location | In Git |
| --- | --- | --- |
| Research and search brief | `data/processed/company_research.json` | Yes, with no personal data |
| Contacts | `data/contacts/contacts.csv` | Never |
| Costs | `docs/credit_ledger.csv` | Yes |

The research file uses the same shape as the CRM's `web/data/profiles.json` (`about`, `news`, `closedPlants`, `checkedOn`), plus a `searchBrief` object. Every item has a source link.

The contact file needs these columns: `legal_parent_name`, `first_name`, `last_name`, `role`, `title`, `email`, `email_validation_status`, `domain`, `linkedin_url`, `location`. The CRM seed attaches these to the parent. Attaching a contact to a business still needs code.

## Where the data lives

The CRM database (`web/prisma/schema.prisma`) holds contacts and research for now. We will mirror it into Supabase later.

Before the mirror:

- Add the fields the Supabase schema lacks. Its `contacts` table has no email, email status, LinkedIn, location or warning field, and `accounts` has no place for research.
- Turn on row-level security for every table, including contacts and login tables. The `anon` key must not read them.
- Test with the `anon` key that contact and login reads are refused.

## Keeping the 60-day test fair

- Research and search every account the same way, whatever its email group. Otherwise a better reply rate could come from better contacts and not from the angle.
- Research can change who gets the email. It does not change the email text.
- If research shows that an account's signal is wrong, pause the account and record why.

## Cost

| Item | Basis | Estimate for 250 accounts |
| --- | --- | --- |
| Keenable | 20 requests for the one account tested (Polynt) | About 5,000 requests. The test was on the free allowance, with 99,881 of 100,000 left. We have not checked the allowance terms. |
| Exa, fallback only | 0.007 USD per search, from a 25-company test | 1.75 USD for each search that all 250 accounts need. The fallback should need less. |
| Contact search | `search_contact` charged 0 credits in a 5-account test | 0 credits, if the free allowance holds. We have not checked its limit. |
| Email lookup | 1.67 credits for 8 people | About 105 credits for 2 contacts each |

Exa bills the owner of the API key in dollars. Deepline credits do not pay for it.

The Deepline balance on 2026-11-25 was 285.58 credits. The estimates come from very small samples. Run a dry run and get the owner's approval before each paid run, read the balance before and after, and log every call.

The larger cost may be the work of reading results and writing the brief for 250 accounts. We have only done that for one.

## What the earlier tests showed

Five accounts, contact search without research first:

- 4 of 5 returned contacts. Valero returned none.
- 8 contacts picked, 6 emails found, 4 of them `valid`.

This is the baseline the research step has to beat.

Exa news search, 25 parent companies (`pipeline/02d_news.mjs`):

- 200 results, 146 kept, and 23 companies had at least one. The run cost 0.175 USD.
- It dated one 2016 blog post as 2026, so read each page before using it.
- The script searches mainly for expansion news and reads an older company list. The fallback needs searches for ownership, closures, sales and domains, run on the 250 accounts.
- We have not compared Exa and Keenable on the same accounts, or tested Exa for company information.

## Rollout

1. **Pilot, 10 accounts.** Include accounts with several businesses, with a review note, from both email groups, and some of the five already tested.
2. **Review.** Record, per account: whether the brief changed the search and why, roles filled, valid emails, contacts a person rejected, requests, credits and time spent. Also record whether Exa ran, for which question, and whether it added a fact that changed the brief.
3. **Go or adjust.** Proposed bar: at least 8 of 10 accounts have one confirmed contact with a valid email. Drop Exa if it added nothing that changed a brief.
4. **The rest, in batches of 50 by rank,** with a spot check after each batch.

## Open decisions

| Decision | Suggestion |
| --- | --- |
| Who writes the search brief | An agent drafts it with sources, a person checks every `Hold` and a sample of the rest |
| Does the battle card spec keep its EPA angle? | Remove it. The CRM work treats EPA as background only, with two email groups, OSHA and Control. |
| When to mirror the CRM into Supabase | After the pilot, once the fields have stopped changing |
| How fresh research must be | Recheck before an account enters outreach if it is more than 30 days old |
