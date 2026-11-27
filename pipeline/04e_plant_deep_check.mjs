// Step 04e: the wide version of steps 04c and 04d. It covers every candidate start plant (up to 3 per
// account) and fetches every search result that names the company, not only results with an event word
// in the search extract.
//
// Usage:
//   node pipeline/04e_plant_deep_check.mjs run        search and fetch. A second run continues.
//   node pipeline/04e_plant_deep_check.mjs passages   write the event sentences from the full pages. No network.
//
// A plant with no passage is not proven open. A person or an agent reads the passages.
// ACCOUNTS and CHECK_OUT change the account file and the output folder, for a test on other accounts.
// Needs KEENABLE_API_KEY. Uses the free allowance and stops if a response says a call was paid.
// Output: data/raw/plant_deep/ (Git ignores it). Page text can name people.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SOURCE, readCsv, candidatePlants, brandTokens, namesCompany } from './plants.mjs';

const OUT = process.env.CHECK_OUT || 'data/raw/plant_deep';
const SEARCHES = path.join(OUT, 'searches.json');
const PAGES = path.join(OUT, 'pages.json');
const SINCE = '2023-11-01';
const BATCH = 10;
const WORKERS = 3;
const QUERIES = ['plant closure OR shutdown OR idled', 'plant sold OR acquired OR acquisition', 'fire OR explosion OR fatality'];
const SKIP = /pitchbook|zoominfo|dnb\.com|crunchbase|rocketreach|emploive|tealhq|indeed|glassdoor|ziprecruiter|linkedin|cards\.keenable|law360/i;

const load = (f, empty) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : empty);
const save = (f, v) => fs.writeFileSync(f, JSON.stringify(v));

const plants = readCsv(process.env.ACCOUNTS || 'data/processed/accounts_250.csv').flatMap((a) => candidatePlants(a).map((p, i) => ({
  key: `${a.rank}-${i + 1}`, rank: Number(a.rank), order: i + 1, account: a.account_name,
  name: p.business || a.account_name, city: p.city, state: p.state, facility: p.facility,
})));

// ---- network ----

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let paid = false;
let searchCalls = 0;
let pagesRead = 0;

async function post(route, body) {
  for (let attempt = 1; ; attempt++) {
    await wait(350);
    let res;
    try {
      res = await fetch(`https://api.keenable.ai/v1/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.KEENABLE_API_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
    } catch (e) {
      if (attempt < 4) { await wait(3000 * attempt); continue; }
      throw e;
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await wait(1000 * Number(res.headers.get('retry-after') || 3 * attempt)); continue; }
    throw new Error(`Keenable answered HTTP ${res.status}`);
  }
}

async function pool(queue, work, failed) {
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (queue.length && !paid && failed.length <= 10) {
      const item = queue.shift();
      try { await work(item); } catch (e) { failed.push(e.message); }
    }
  }));
}

function ledger(endpoint, count, unit) {
  if (!count) return;
  execFileSync('node', ['pipeline/ledger.mjs', 'add', '04e plant deep check', 'keenable', endpoint, String(count), `${count} ${unit}`, '', paid ? '' : '0', '', 'API response usage fields', paid ? 'A response reported a paid call. Check the balance.' : 'Free allowance.'], { stdio: 'inherit' });
}

async function run() {
  for (const dir of ['.', '../..', SOURCE, path.join(SOURCE, '../..')]) {
    const f = path.join(dir, '.env.local');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      if (i > 0 && !line.startsWith('#') && !process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!process.env.KEENABLE_API_KEY) throw new Error('KEENABLE_API_KEY is not set');
  fs.mkdirSync(OUT, { recursive: true });
  const searches = load(SEARCHES, {});
  const pages = load(PAGES, load('data/raw/plant_pages/pages.json', {}));
  const failed = [];
  try {
    let done = 0;
    await pool(plants.filter((p) => !searches[p.key]), async (p) => {
      const urls = new Map();
      for (const q of QUERIES) {
        const json = await post('search', { query: `${brandTokens(p.name).join(' ')} ${p.city} ${p.state} ${q}`, max_results: 6, published_after: SINCE });
        searchCalls++;
        if (json.usage?.paid) paid = true;
        for (const r of json.results || []) {
          const text = `${r.title || ''} ${r.snippet || ''} ${r.url}`;
          if (r.url && !SKIP.test(r.url) && namesCompany(p.name, p.city, text)) urls.set(r.url, String(r.published_at || '').slice(0, 10));
        }
      }
      searches[p.key] = [...urls].map(([url, published]) => ({ url, published }));
      if (++done % 25 === 0) { save(SEARCHES, searches); console.log(`searched ${done} plants`); }
    }, failed);
    save(SEARCHES, searches);

    const todo = [...new Set(Object.values(searches).flat().map((r) => r.url))].filter((u) => !pages[u]);
    const batches = [];
    for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    console.log(`${todo.length} new pages to fetch`);
    let n = 0;
    await pool(batches, async (urls) => {
      const json = await post('fetch', { urls, content: { max_chars: 60000 } });
      // Results come back in the order of the request.
      (json.results || []).forEach((r, j) => {
        pages[urls[j]] = r.error ? { error: r.message || String(r.error) } : { title: r.title || '', published: String(r.published_at || '').slice(0, 10), truncated: Boolean(r.truncated), content: r.content || '' };
        if (!r.error) pagesRead++;
        if (r.usage?.paid) paid = true;
      });
      if (++n % 20 === 0) { save(PAGES, pages); console.log(`fetched ${n} batches`); }
    }, failed);
    save(PAGES, pages);
  } finally {
    ledger('v1/search', searchCalls, 'searches');
    ledger('v1/fetch', pagesRead, 'pages');
  }
  const wanted = [...new Set(Object.values(searches).flat().map((r) => r.url))];
  console.log(JSON.stringify({ plants: plants.length, searched: Object.keys(searches).length, searches: searchCalls, urls: wanted.length, new_pages: pagesRead, with_text: wanted.filter((u) => pages[u] && !pages[u].error).length, page_errors: wanted.filter((u) => pages[u]?.error).length, not_fetched: wanted.filter((u) => !pages[u]).length, paid, failed }));
}

// ---- passages ----

const EVENT = /\b(clos(e|es|ed|ing|ure)|shut(s|ting|tered)?( ?down)?|idl(e|es|ed|ing)|ceas(e|es|ed|ing)|layoffs?|laid off|WARN notice|sold|to sell|sale of|acquir(e|es|ed|ing)|acquisition|divest\w*|bankrupt\w*|chapter 11|fire|blaze|explosion|blast|killed|dies|died|death|fatal\w*|injur\w*|hospitali\w*|chemical (leak|release|spill)|ammonia leak|evacuat\w*)\b/i;
const clean = (s) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ').replace(/[#*_|>`-]{2,}/g, ' ').replace(/[#*`]/g, '').replace(/\s+/g, ' ');

/** The best event sentence of one page for one plant, or null. The page must name the city and the company. */
function passage(plant, url, page, searchDate) {
  const text = clean(`${page.title}. ${page.content}`);
  const lower = text.toLowerCase();
  const city = plant.city.toLowerCase();
  const brand = brandTokens(plant.name)[0]?.toLowerCase() || '';
  if (!lower.includes(city) || !lower.includes(brand)) return null;
  const date = page.published || searchDate || '';
  if (date && date < SINCE) return null;
  const head = `${page.title} ${text.slice(0, 600)}`.toLowerCase();
  const s = text.split(/(?<=[.!?])\s+(?=[A-Z"“])/);
  let best = null;
  s.forEach((x, i) => {
    if (x.length > 600 || !EVENT.test(x)) return;
    const around = s.slice(Math.max(0, i - 3), i + 4).join(' ').toLowerCase();
    const near = around.includes(city);
    if (!near && !head.includes(city)) return;
    const score = (x.toLowerCase().includes(city) ? 4 : near ? 2 : 0) + (head.includes(city) ? 3 : 0) + (head.includes(brand) ? 3 : 0)
      + (/^202[56]/.test(date) ? 4 : /^2024/.test(date) ? 1 : 0) + (x.toLowerCase().includes(brand) ? 1 : 0)
      + (/\b(killed|dies|died|fatal|explosion|will close|closing|has sold|to be acquired)\b/i.test(x) ? 2 : 0);
    if (!best || score > best.score) best = { url, date, score, title: page.title, text: [x, s[i + 1]].filter((y) => y && y.length < 500).join(' ').slice(0, 240) };
  });
  return best;
}

function passages() {
  const searches = load(SEARCHES, {});
  const pages = load(PAGES, {});
  const out = [];
  let none = 0;
  for (const p of plants) {
    const found = (searches[p.key] || [])
      .map((r) => (pages[r.url] && !pages[r.url].error ? passage(p, r.url, pages[r.url], r.published) : null))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    const titles = new Set();
    const pick = found.filter((f) => !titles.has(f.title) && titles.add(f.title)).slice(0, 3);
    if (!pick.length) { none++; continue; }
    out.push({ ...p, passages: pick });
  }
  save(path.join(OUT, 'passages.json'), out);
  console.log(JSON.stringify({ plants: plants.length, with_passage: out.length, without_passage: none, passages: out.reduce((n, p) => n + p.passages.length, 0) }));
}

const mode = process.argv[2];
if (mode === 'run') await run();
else if (mode === 'passages') passages();
else { console.error('Usage: node pipeline/04e_plant_deep_check.mjs run|passages'); process.exit(1); }
