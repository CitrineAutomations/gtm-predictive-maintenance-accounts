// Step 04a: collect company facts and recent news for one account, before the contact search.
// The script only collects sources. It does not write the search brief. A person or an agent reads
// the output and writes the brief (see docs/contact_enrichment.md).
//
// Usage:
//   node pipeline/04a_research.mjs plan "VALERO ENERGY CORP"      print the queries. No network calls.
//   node pipeline/04a_research.mjs run "VALERO ENERGY CORP"       Keenable searches and page reads
//   node pipeline/04a_research.mjs exa "VALERO ENERGY CORP" 1,3   Exa fallback for the questions left open
//
// Questions for the fallback:
//   1  does the company still own and run the start plant?
//   2  what is the website domain?
//   3  is there a recent sale, closure or acquisition?
// The fourth question (job titles) never triggers Exa.
//
// Needs KEENABLE_API_KEY (and EXA_API_KEY for exa) in the environment or .env.local.
// PIPELINE_DIR points at the folder that holds the ignored files from steps 01, 02c and 03b.
//
// Cost: Keenable uses the monthly free allowance. The script stops if a response says it was paid.
// Exa bills the key owner in dollars. Every run that makes calls adds a row to docs/credit_ledger.csv.
//
// Output: data/raw/research/<account>.json, which Git ignores. Page text can name people,
// so it must not move into a committed file.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SOURCE, readCsv, candidatePlants, brandTokens, namesCompany as matches } from './plants.mjs';

const OUT = 'data/raw/research';
const MAX_RESULTS = 6;
const BATCH = 10; // pages in one fetch call
const MAX_PAGE_CHARS = 60000;
const PAUSE_MS = 200; // Keenable allows 10 requests a second

const [mode, accountName, openList] = process.argv.slice(2);
if (!['plan', 'run', 'exa'].includes(mode) || !accountName) {
  console.error('Usage: node pipeline/04a_research.mjs plan|run "<account>"  |  exa "<account>" 1,2,3');
  process.exit(1);
}

function loadEnv() {
  for (const dir of ['.', '../..', SOURCE, path.join(SOURCE, '../..')]) {
    const f = path.join(dir, '.env.local');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0 && !line.startsWith('#')) {
        const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      }
    }
  }
}

// ---- The account and its candidate start plants ----

const account = readCsv('data/processed/accounts_250.csv')
  .find((a) => [a.account_name, a.legal_parent_name].some((n) => n.toUpperCase() === accountName.toUpperCase()));
if (!account) throw new Error(`Not one of the 250 accounts: ${accountName}`);

const plants = candidatePlants(account);
const start = plants[0];
if (!start) throw new Error(`No plant with a serious OSHA citation found for ${account.account_name}`);
// Search for the business that runs the start plant when the account has several.
const name = start.business || account.account_name;
const slug = account.account_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sinceDate = new Date(); sinceDate.setFullYear(sinceDate.getFullYear() - 1);
const since = sinceDate.toISOString().slice(0, 10);
const where = `${start.city} ${start.state}`;

// ---- Queries ----

const QUERIES = [
  { id: 'website', question: 2, news: false, q: `${name} official website` },
  { id: 'business', question: 2, news: false, q: `${name} company what it makes business units` },
  { id: 'owner', question: 1, news: false, q: `${name} owner parent company acquired by` },
  { id: 'plant', question: 1, news: false, q: `${name} ${where} plant` },
  { id: 'closure', question: 3, news: true, q: `${name} plant closure OR layoffs` },
  { id: 'sale', question: 3, news: true, q: `${name} acquisition OR sale announced` },
  { id: 'plant_news', question: 1, news: true, q: `${name} ${where} plant news` },
  { id: 'expansion', question: null, news: true, q: `${name} expansion new line investment` },
  { id: 'jobs', question: 4, news: true, q: `${name} maintenance manager OR reliability engineer job ${start.city}` },
  { id: 'tools', question: null, news: false, q: `${name} predictive maintenance OR condition monitoring` },
];

const EXA_QUERIES = {
  1: { news: false, q: `${name} ${where} plant owner sold OR closed` },
  2: { news: false, q: `${name} official company website` },
  3: { news: true, q: `${name} acquisition OR sale OR plant closure announcement` },
};

if (mode === 'plan') {
  console.log(JSON.stringify({ account: account.account_name, search_name: name, candidate_plants: plants, review_note: account.review_note, news_since: since, queries: QUERIES.map((x) => `${x.id}: ${x.q}`) }, null, 2));
  process.exit(0);
}

// ---- Result filters ----

const tokens = brandTokens(name);
const namesCompany = (text) => matches(name, start.city, text);
const isPersonProfile = (url) => /linkedin\.com\/in\//i.test(url);

/** Drops person profiles and repeats. A result that does not name the company is kept and marked. */
function tidy(results, textOf) {
  const seen = new Set();
  return results
    .filter((r) => r.url && !isPersonProfile(r.url) && !seen.has(r.url) && seen.add(r.url))
    .map((r) => ({
      title: r.title || '', url: r.url, published: String(r.published_at || r.publishedDate || '').slice(0, 10),
      text: textOf(r), names_company: namesCompany(`${r.title} ${textOf(r)} ${r.url}`),
    }));
}

// ---- Which pages to read ----

// Company data sites and job copy sites. Their pages are second hand and can be wrong or old.
const SKIP_HOSTS = ['pitchbook.com', 'zoominfo.com', 'dnb.com', 'crunchbase.com', 'rocketreach.co', 'emploive.com', 'tealhq.com',
  'indeed.com', 'glassdoor.com', 'ziprecruiter.com', 'linkedin.com', 'cards.keenable.ai', 'law360.com'];
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isSkipped = (url) => SKIP_HOSTS.some((h) => hostOf(url) === h || hostOf(url).endsWith(`.${h}`));
// A guess: the web address holds a word of the company name. It misses domains such as an abbreviation.
const isCompanySite = (url) => tokens.some((t) => t.length >= 4 && hostOf(url).split('.').slice(0, -1).join('.').includes(t.toLowerCase()));

/** Every result that names the company, company pages first. A search extract is not enough to judge. */
function pickPages(searches) {
  const urls = [...new Set(searches.flatMap((s) => s.results).filter((r) => r.names_company && !isSkipped(r.url)).map((r) => r.url))];
  return urls.sort((a, b) => isCompanySite(b) - isCompanySite(a));
}

// ---- API calls ----

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const used = { searches: 0, pages: 0, exaSearches: 0, exaUsd: 0 };

async function post(url, headers, body) {
  for (let attempt = 1; ; attempt++) {
    await wait(PAUSE_MS);
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 3) { await wait(1000 * Number(res.headers.get('retry-after') || 2)); continue; }
    throw new Error(`${url} answered HTTP ${res.status}`);
  }
}

async function keenable(endpoint, body) {
  const json = await post(`https://api.keenable.ai/v1/${endpoint}`, { 'x-api-key': process.env.KEENABLE_API_KEY }, body);
  const usages = [json.usage, ...(json.results || []).map((r) => r.usage)].filter(Boolean);
  if (usages.some((u) => u.paid)) used.stopPaid = true;
  return json;
}

function ledger(provider, tool, calls, units, usd, note) {
  execFileSync('node', ['pipeline/ledger.mjs', 'add', '04a research', provider, tool, String(calls), units, '', String(usd), '', 'API response usage fields', note], { stdio: 'inherit' });
}

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `${slug}.json`);
loadEnv();

if (mode === 'run') {
  if (!process.env.KEENABLE_API_KEY) throw new Error('KEENABLE_API_KEY is not set');
  // Never overwrite a raw file.
  if (fs.existsSync(file)) throw new Error(`${file} exists. Move it before a new run.`);
  const record = { account: account.account_name, legal_parent_name: account.legal_parent_name, search_name: name, checked_on: new Date().toISOString().slice(0, 10), news_since: since, review_note: account.review_note, candidate_plants: plants, searches: [], pages: [] };
  try {
    for (const query of QUERIES) {
      const json = await keenable('search', { query: query.q, max_results: MAX_RESULTS, ...(query.news ? { published_after: since } : {}) });
      used.searches++;
      record.searches.push({ ...query, results: tidy(json.results || [], (r) => r.snippet || '') });
      if (used.stopPaid) throw new Error('Keenable reports a paid call. Stopped.');
    }
    const urls = pickPages(record.searches);
    for (let i = 0; i < urls.length && !used.stopPaid; i += BATCH) {
      const batch = urls.slice(i, i + BATCH);
      const json = await keenable('fetch', { urls: batch, content: { max_chars: MAX_PAGE_CHARS } });
      used.pages += batch.length;
      // Results come back in the order of the request.
      record.pages.push(...(json.results || []).map((r, j) => (r.error
        ? { url: batch[j], error: r.error }
        : { url: batch[j], title: r.title || '', published: String(r.published_at || '').slice(0, 10), truncated: Boolean(r.truncated), content: r.content || '' })));
    }
  } finally {
    // Keep what we have and log the calls, also after a failure.
    if (used.searches) {
      fs.writeFileSync(file, JSON.stringify(record, null, 2));
      ledger('keenable', 'v1/search + v1/fetch', used.searches + used.pages, `${used.searches} searches, ${used.pages} pages, 1 account`, used.stopPaid ? '' : 0, used.stopPaid ? 'A response reported a paid call. Check the Keenable balance.' : 'Free allowance.');
    }
  }
} else {
  const open = [...new Set(String(openList || '').split(',').filter((n) => EXA_QUERIES[n]))];
  if (!open.length) throw new Error('Give the open questions, for example 1,3');
  if (!process.env.EXA_API_KEY) throw new Error('EXA_API_KEY is not set');
  if (!fs.existsSync(file)) throw new Error('Run the Keenable step first.');
  const exaFile = path.join(OUT, `${slug}.exa-${open.join('')}.json`);
  if (fs.existsSync(exaFile)) throw new Error(`${exaFile} exists. These questions already ran.`);
  const record = { account: account.account_name, checked_on: new Date().toISOString().slice(0, 10), searches: [] };
  try {
    for (const n of open) {
      const query = EXA_QUERIES[n];
      const json = await post('https://api.exa.ai/search', { 'x-api-key': process.env.EXA_API_KEY }, { query: query.q, numResults: MAX_RESULTS, type: 'auto', contents: { text: { maxCharacters: 600 } }, ...(query.news ? { startPublishedDate: sinceDate.toISOString() } : {}) });
      used.exaSearches++;
      used.exaUsd += json.costDollars?.total || 0;
      record.searches.push({ question: Number(n), q: query.q, results: tidy(json.results || [], (r) => r.text || '') });
    }
  } finally {
    if (used.exaSearches) {
      fs.writeFileSync(exaFile, JSON.stringify(record, null, 2));
      ledger('exa', 'search + page text', used.exaSearches, `questions ${open.join(' ')}, 1 account`, Math.round(used.exaUsd * 1000) / 1000, 'Fallback after Keenable.');
    }
  }
}

console.log(JSON.stringify({ account: account.account_name, file, ...used }, null, 2));
