// Step 04c: look for news that rules out a start plant, for all 250 accounts, before any paid contact search.
// Usage:
//   node pipeline/04c_plant_check.mjs [limit]
//
// Three Keenable searches for each account's start plant: closure, sale and serious incident.
// The script only flags results by keyword. A person or an agent reads each flag before it changes a plant.
// A plant with no flag is not proven open. The searches found nothing.
//
// Needs KEENABLE_API_KEY. Uses the free allowance and stops if a response says a call was paid.
// Output: data/raw/plant_check/ (Git ignores it). One file per account, so a stopped run can continue.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SOURCE, readCsv, candidatePlants, brandTokens, namesCompany } from './plants.mjs';

const OUT = 'data/raw/plant_check';
const SINCE = '2023-11-01';
const WORKERS = 3;
const KINDS = {
  closure: { q: 'plant closure OR shutdown OR idled', words: /\b(clos(e|es|ed|ing|ure)|shut(s|ting)? ?down|shutter(s|ed|ing)?|idl(e|es|ed|ing)|ceas(e|es|ed|ing))\b/i },
  sale: { q: 'plant sold OR acquired OR acquisition', words: /\b(sold|sells?|sale of|acquir(e|es|ed|ing)|acquisition|divest\w*|bankrupt\w*|chapter 11)\b/i },
  incident: { q: 'fire OR explosion OR fatality', words: /\b(fire|explosion|fatal\w*|died|dies|killed)\b/i },
};
const SKIP = /pitchbook|zoominfo|dnb\.com|crunchbase|rocketreach|emploive|tealhq|indeed|glassdoor|ziprecruiter|linkedin|cards\.keenable|law360/i;

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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let searches = 0;
let paid = false;

async function search(query) {
  for (let attempt = 1; ; attempt++) {
    await wait(350);
    let res;
    try {
      res = await fetch('https://api.keenable.ai/v1/search', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.KEENABLE_API_KEY }, body: JSON.stringify({ query, max_results: 6, published_after: SINCE }), signal: AbortSignal.timeout(60000) });
    } catch (e) {
      if (attempt < 4) { await wait(2000 * attempt); continue; }
      throw e;
    }
    if (res.ok) {
      const json = await res.json();
      searches++;
      if (json.usage?.paid) paid = true;
      return json.results || [];
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await wait(1000 * Number(res.headers.get('retry-after') || 2 * attempt)); continue; }
    throw new Error(`Keenable answered HTTP ${res.status}`);
  }
}

async function check(account) {
  const file = path.join(OUT, `${String(account.rank).padStart(3, '0')}.json`);
  if (fs.existsSync(file)) return;
  const [plant] = candidatePlants(account);
  const record = { rank: Number(account.rank), account: account.account_name, plant: plant || null, flags: [] };
  if (plant) {
    const name = plant.business || account.account_name;
    for (const [kind, { q, words }] of Object.entries(KINDS)) {
      for (const r of await search(`${brandTokens(name).join(' ')} ${plant.city} ${plant.state} ${q}`)) {
        const text = `${r.title || ''} ${r.snippet || ''}`;
        if (!r.url || SKIP.test(r.url) || !words.test(text)) continue;
        if (!text.toLowerCase().includes(plant.city.toLowerCase()) || !namesCompany(name, plant.city, `${text} ${r.url}`)) continue;
        record.flags.push({ kind, url: r.url, published: String(r.published_at || '').slice(0, 10), title: r.title || '', snippet: (r.snippet || '').slice(0, 1500) });
      }
    }
  }
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
}

fs.mkdirSync(OUT, { recursive: true });
const queue = readCsv('data/processed/accounts_250.csv').slice(0, Number(process.argv[2]) || 250);
const failed = [];
try {
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (queue.length && !paid) {
      const account = queue.shift();
      try { await check(account); } catch (e) { failed.push(`${account.rank}: ${e.message}`); }
      if (failed.length > 10) break;
    }
  }));
} finally {
  if (searches) {
    execFileSync('node', ['pipeline/ledger.mjs', 'add', '04c plant check', 'keenable', 'v1/search', String(searches), `${searches} searches`, '', paid ? '' : '0', '', 'API response usage fields', paid ? 'A response reported a paid call. Check the balance.' : 'Free allowance.'], { stdio: 'inherit' });
  }
}
const done = fs.readdirSync(OUT).filter((f) => /^\d{3}\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f))));
console.log(JSON.stringify({ accounts_checked: done.length, searches, paid, failed, no_plant: done.filter((d) => !d.plant).length, accounts_flagged: Object.fromEntries(Object.keys(KINDS).map((k) => [k, done.filter((d) => d.flags.some((x) => x.kind === k)).length])), accounts_any_flag: done.filter((d) => d.flags.length).length }, null, 2));
