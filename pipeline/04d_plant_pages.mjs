// Step 04d: read the full page behind every flag from step 04c. A search extract is not enough to
// decide that a plant is closed, sold or unsafe to contact.
// Usage: node pipeline/04d_plant_pages.mjs
// Needs KEENABLE_API_KEY. Uses the free allowance and stops if a response says a page was paid.
// Output: data/raw/plant_pages/pages.json (Git ignores it). A second run fetches only missing pages.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SOURCE } from './plants.mjs';

const IN = 'data/raw/plant_check';
const OUT = 'data/raw/plant_pages';
const FILE = path.join(OUT, 'pages.json');
const BATCH = 10;

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
async function fetchBatch(urls) {
  for (let attempt = 1; ; attempt++) {
    await wait(300);
    let res;
    try {
      res = await fetch('https://api.keenable.ai/v1/fetch', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.KEENABLE_API_KEY }, body: JSON.stringify({ urls, content: { max_chars: 60000 } }), signal: AbortSignal.timeout(180000) });
    } catch (e) {
      if (attempt < 3) { await wait(3000 * attempt); continue; }
      throw e;
    }
    if (res.ok) return (await res.json()).results || [];
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await wait(1000 * Number(res.headers.get('retry-after') || 3 * attempt)); continue; }
    throw new Error(`Keenable answered HTTP ${res.status}`);
  }
}

const wanted = [...new Set(fs.readdirSync(IN).filter((f) => /^\d{3}\.json$/.test(f))
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(IN, f))).flags.map((x) => x.url)))];
fs.mkdirSync(OUT, { recursive: true });
const pages = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : {};
const todo = wanted.filter((u) => !pages[u]);
let fetched = 0; let paid = false; const failedBatches = [];
try {
  for (let i = 0; i < todo.length && !paid; i += BATCH) {
    const urls = todo.slice(i, i + BATCH);
    try {
      const results = await fetchBatch(urls);
      // Results come back in the order of the request.
      results.forEach((r, j) => {
        pages[urls[j]] = r.error ? { error: r.message || String(r.error) } : { title: r.title || '', published: String(r.published_at || '').slice(0, 10), truncated: Boolean(r.truncated), content: r.content || '' };
        if (!r.error) fetched++;
        if (r.usage?.paid) paid = true;
      });
    } catch (e) { failedBatches.push(e.message); if (failedBatches.length > 5) break; }
    fs.writeFileSync(FILE, JSON.stringify(pages));
    process.stdout.write(`\r${Math.min(i + BATCH, todo.length)}/${todo.length} pages`);
  }
} finally {
  if (fetched) execFileSync('node', ['pipeline/ledger.mjs', 'add', '04d plant pages', 'keenable', 'v1/fetch', String(fetched), `${fetched} pages`, '', paid ? '' : '0', '', 'API response usage fields', paid ? 'A response reported a paid call. Check the balance.' : 'Free allowance.'], { stdio: 'inherit' });
}
const have = wanted.filter((u) => pages[u] && !pages[u].error);
console.log(`\n${JSON.stringify({ wanted: wanted.length, with_text: have.length, page_errors: wanted.filter((u) => pages[u]?.error).length, not_fetched: wanted.filter((u) => !pages[u]).length, truncated: have.filter((u) => pages[u].truncated).length, chars: have.reduce((n, u) => n + pages[u].content.length, 0), paid, failedBatches })}`);
