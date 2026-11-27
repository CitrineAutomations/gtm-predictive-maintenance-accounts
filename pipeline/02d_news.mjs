// Step 02d: recent plant news for each shortlist parent, from Exa web search.
// Usage:
//   node pipeline/02d_news.mjs sample   the 25 parents in data/raw/maps/queries.tsv (about $0.18)
//   node pipeline/02d_news.mjs all      all parents in tri_shortlist_parents.csv (about $0.007 each)
//
// Needs EXA_API_KEY in the environment or in .env.local (this folder, or two folders up for a worktree).
// Exa bills the key owner directly. Deepline credits do not pay for these calls.
//
// Rules learned from the 12-parent test:
//   - Drop linkedin.com/in/ results. They describe named people.
//   - Keep a result only when the brand name appears in the title or the page text.
//   - Drop a result when the page text shows an old year in its first 400 characters
//     (Exa dated a 2016 blog post as 2026).
// The output keeps title, URL, date and host. It does not keep page text.

import fs from 'node:fs';
import path from 'node:path';

const OUT = 'data/processed';
const MODE = process.argv[2];
const MONTHS_BACK = 12;
const NUM_RESULTS = 8;

function loadEnv() {
  for (const f of ['.env.local', '../../.env.local']) {
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
loadEnv();
if (!process.env.EXA_API_KEY) throw new Error('EXA_API_KEY is not set');

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const header = lines[0].split(',').map((h) => h.replace(/"/g, ''));
  return lines.slice(1).map((line) => {
    const v = line.match(/"[^"]*"|[^,]+/g) || [];
    return Object.fromEntries(header.map((h, i) => [h, (v[i] || '').replace(/^"|"$/g, '')]));
  });
}

const STOP = new Set(['INC', 'CORP', 'CORPORATION', 'LLC', 'CO', 'COMPANY', 'LP', 'LTD', 'HOLDING', 'HOLDINGS', 'THE', 'INTERMEDIATE', 'OPERATIONS', 'USA', 'US', 'AND', 'OF']);
const brandTokens = (name) =>
  String(name).toUpperCase().replace(/['’]/g, '').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 1 && !STOP.has(t));

let parents = readCsv(path.join(OUT, 'tri_shortlist_parents.csv')).map((p) => p.parent_name);
if (MODE === 'sample') {
  parents = fs.readFileSync('data/raw/maps/queries.tsv', 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[1]);
} else if (MODE !== 'all') {
  console.error('Usage: node pipeline/02d_news.mjs sample|all');
  process.exit(1);
}

const since = new Date(); since.setMonth(since.getMonth() - MONTHS_BACK);
const startPublishedDate = since.toISOString();
const TYPES = [
  ['closure', /\b(clos(e|es|ing|ure)|shut ?down|layoff|idle[sd]?)\b/i],
  ['violation', /\b(violation|penalt(y|ies)|fined|citation|consent decree)\b/i],
  ['acquisition', /\b(acqui(re|res|red|sition)|merger|sold|sale of|buys?)\b/i],
  ['expansion', /\b(expan(d|ds|ding|sion)|new (plant|facility|factory|mill)|invest(s|ment)?|ground ?breaking|opens?|capacity)\b/i],
];
const typeOf = (title) => (TYPES.find(([, re]) => re.test(title)) || ['other'])[0];

const rows = []; const stats = [];
let cost = 0;
for (const parent of parents) {
  const tokens = brandTokens(parent);
  const query = `${tokens.join(' ')} new plant or facility expansion investment announcement`;
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'x-api-key': process.env.EXA_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ query, numResults: NUM_RESULTS, startPublishedDate, type: 'auto', contents: { text: { maxCharacters: 600 } } }),
  });
  if (!res.ok) { stats.push({ parent, error: res.status }); continue; }
  const j = await res.json();
  cost += j.costDollars?.total || 0;
  let kept = 0; let dropped = { person: 0, name: 0, old: 0 };
  const seen = new Set();
  for (const r of j.results || []) {
    if (/linkedin\.com\/in\//i.test(r.url)) { dropped.person++; continue; }
    const text = `${r.title || ''} ${r.text || ''}`.toUpperCase().replace(/['’]/g, '');
    const need = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.67);
    if (tokens.filter((t) => text.includes(t)).length < need) { dropped.name++; continue; }
    const years = [...String(r.text || '').slice(0, 400).matchAll(/\b(20[0-9]{2})\b/g)].map((m) => Number(m[1]));
    const pubYear = r.publishedDate ? Number(r.publishedDate.slice(0, 4)) : null;
    if (pubYear && years.length && Math.max(...years) < pubYear - 1) { dropped.old++; continue; }
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    kept++;
    rows.push({
      parent_name: parent, story_type: typeOf(r.title || ''), published: (r.publishedDate || '').slice(0, 10),
      title: (r.title || '').replace(/\s+/g, ' ').slice(0, 160), url: r.url, host: new URL(r.url).host,
    });
  }
  stats.push({ parent, returned: (j.results || []).length, kept, ...dropped });
}

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cols = ['parent_name', 'story_type', 'published', 'title', 'url', 'host'];
const file = MODE === 'sample' ? 'news_signals_sample.csv' : 'news_signals.csv';
fs.writeFileSync(path.join(OUT, file), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
const okStats = stats.filter((s) => !s.error);
const byType = {};
for (const r of rows) byType[r.story_type] = (byType[r.story_type] || 0) + 1;
const summary = {
  mode: MODE, since: startPublishedDate.slice(0, 10), parents: parents.length, errors: stats.length - okStats.length,
  results_returned: okStats.reduce((a, s) => a + s.returned, 0),
  results_kept: rows.length,
  dropped_person_profiles: okStats.reduce((a, s) => a + s.person, 0),
  dropped_name_check: okStats.reduce((a, s) => a + s.name, 0),
  dropped_old_date: okStats.reduce((a, s) => a + s.old, 0),
  parents_with_a_kept_result: okStats.filter((s) => s.kept > 0).length,
  kept_by_story_type: byType,
  exa_cost_usd: Math.round(cost * 1000) / 1000,
};
fs.writeFileSync(path.join(OUT, MODE === 'sample' ? 'news_summary_sample.json' : 'news_summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
