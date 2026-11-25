# Mini CRM

A small CRM for the 250 target accounts.

- A sidebar with Accounts, Contacts, Activity, 60-day test and Playbook, plus a "Go to company" box.
- Each account page has tabs: battle card, contacts, email, company tree, why now and activity.
- The battle card shows the start plant, who to contact first, the OSHA inspection record with a link, the EPA report link, the email and what not to say.
- Each account has one email group. About 20% get the control email, chosen at random inside three size groups.

Accounts listed in `data/profiles.json` also get "About the company" and "Recent news" sections, with a source link for each item. A plant that a source reports as closed is marked in the company tree, and contacts in that city are flagged. Only Polynt has a profile so far.

The EPA quarter counts come from a bulk file dated 2026-11-18 and can be out of date. See the root README.

The seed downloads OSHA inspection records from a third-party copy of the data (free) and caches them in `.cache/`.

It is built on parts of [NextCRM](https://github.com/pdovhomilja/nextcrm-app) (MIT, see `LICENSE.nextcrm`): its stack (Next.js, Prisma, Better Auth), screen components and color tokens. Only the account, contact and activity features are here. Invoices, projects, email, campaigns, documents, AI features and plugins are left out.

## Run it locally

1. `pnpm install`
2. `npx prisma dev --detach --name gtm-mini-crm`, then copy the TCP `postgres://` address it prints.
3. Copy `.env.example` to `.env` and fill it in. Use a long random `BETTER_AUTH_SECRET` and password.
4. `pnpm db:push`
5. `pnpm seed`
6. `pnpm build` and `pnpm start`, then sign in at http://localhost:3000.

The seed needs the output of the pipeline steps, including files that Git ignores (`tri_shortlist_facilities.csv`, `osha_plants.csv`, `echo_plants.csv` and the OSHA cache in `data/raw/`). Set `PIPELINE_DIR` to the folder that has them.

## Contacts

Contacts are personal data. The seed reads them from a CSV outside Git (`CONTACTS_CSV`). Do not commit that file, screenshots with names, or a database dump. The seed script maps the four test accounts by name. A larger contact file needs a `legal_parent_name` column.

A contact is marked as a likely bad record when the last name or mailbox is the company's own name.

## Not done

- No hosted database or deployment yet. Before you use a Supabase database, turn on row-level security for every table, or its public API can read them. That includes contacts and login tables.
- One user. There is no screen to add users.
- No screen to add or edit contacts.
- Inspection facts on the cards come from a third-party copy of OSHA data. Only the Polynt records were checked against the official source.
- The card counts cited standards as items. OSHA counts grouped standards as one violation.
- OSHA links open a search for the company, state and year. They have not been tested.
