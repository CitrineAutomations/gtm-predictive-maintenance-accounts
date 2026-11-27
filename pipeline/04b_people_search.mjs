// Step 04b: free web search for the website and the plant and maintenance leaders at each start plant.
// It runs before any paid lookup. It does not decide who is a contact. A person or an agent reads the output.
// Usage: node pipeline/04b_people_search.mjs <targets.json> <output folder>
//   targets.json: [{ "rank": 2, "business": "Polynt Composites", "city": "Jacksonville", "state": "FL" }]
//
// The output holds names of people, so the folder must be one that Git ignores (data/contacts/).
// LinkedIn pages about a person are left out. Needs KEENABLE_API_KEY. Stops if a response says a call was paid.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [targetsFile, outDir] = process.argv.slice(2);
if (!targetsFile || !outDir) throw new Error('Usage: node pipeline/04b_people_search.mjs <targets.json> <output folder>');
execFileSync('git', ['check-ignore', '-q', path.join(path.resolve(outDir), 'x.json')], { cwd: path.dirname(path.resolve(outDir)) });

for (const dir of ['.', '../..']) {
  const f = path.join(dir, '.env.local');
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    if (i > 0 && !line.startsWith('#') && !process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
}
if (!process.env.KEENABLE_API_KEY) throw new Error('KEENABLE_API_KEY is not set');

const ROLE = /\b(plant|site|facility|maintenance|reliability|operations) (manager|director|superintendent|leader|engineer|supervisor)\b|\bgeneral manager\b|\bdirector of operations\b/i;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let searches = 0;
let pagesRead = 0;
let paid = false;

async function post(route, body) {
  await wait(350);
  const res = await fetch(`https://api.keenable.ai/v1/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.KEENABLE_API_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`Keenable answered HTTP ${res.status}`);
  const json = await res.json();
  if (json.usage?.paid || (json.results || []).some((r) => r.usage?.paid)) paid = true;
  return json.results || [];
}

const targets = JSON.parse(fs.readFileSync(targetsFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
try {
  for (const t of targets) {
    if (paid) break;
    const file = path.join(outDir, `${t.rank}.json`);
    if (fs.existsSync(file)) continue;
    const website = (await post('search', { query: `${t.business} official website`, max_results: 5 })).map((r) => ({ title: r.title, url: r.url }));
    searches++;
    const found = new Map();
    for (const q of [`${t.business} ${t.city} ${t.state} plant manager`, `${t.business} ${t.city} ${t.state} maintenance manager OR reliability`, `${t.business} ${t.city} plant manager announced OR promoted OR said`]) {
      for (const r of await post('search', { query: q, max_results: 8, published_after: '2023-11-01' })) {
        if (r.url && !/linkedin\.com\/in\//i.test(r.url)) found.set(r.url, String(r.published_at || '').slice(0, 10));
      }
      searches++;
    }
    const urls = [...found.keys()].slice(0, 20);
    const results = urls.length ? await post('fetch', { urls, content: { max_chars: 40000 } }) : [];
    const brand = t.business.split(' ')[0].toLowerCase();
    const hits = [];
    results.forEach((r, i) => {
      if (r.error) return;
      pagesRead++;
      const text = `${r.title || ''}. ${r.content || ''}`.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*|`]/g, '').replace(/\s+/g, ' ');
      const lower = text.toLowerCase();
      if (!lower.includes(brand) || !lower.includes(t.city.toLowerCase())) return;
      const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"“])/).filter((s) => ROLE.test(s) && s.length < 400);
      if (sentences.length) hits.push({ url: urls[i], published: r.published_at?.slice(0, 10) || found.get(urls[i]), title: r.title, sentences: sentences.slice(0, 6) });
    });
    fs.writeFileSync(file, JSON.stringify({ ...t, website, pages_searched: urls.length, hits }, null, 2));
    console.log(`${t.rank} ${t.business}: ${hits.length} pages with a role sentence`);
  }
} finally {
  for (const [endpoint, count, unit] of [['v1/search', searches, 'searches'], ['v1/fetch', pagesRead, 'pages']]) {
    if (count) execFileSync('node', ['pipeline/ledger.mjs', 'add', '04b people search', 'keenable', endpoint, String(count), `${count} ${unit}`, '', paid ? '' : '0', '', 'API response usage fields', paid ? 'A response reported a paid call. Check the balance.' : 'Free allowance.'], { stdio: 'inherit' });
  }
}
