// Step 02c: OSHA citation signal for the shortlist plants.
// Usage: node pipeline/02c_osha.mjs
//
// Source: the labordata.bunkum.us mirror of the US Department of Labor OSHA enforcement data.
// The mirror is a third-party copy. It is not the official DOL site. The step reads open data only.
// Pulls manufacturing inspections (NAICS 31 to 33) opened since SINCE that have at least one citation.
// Matches each inspection to a shortlist plant by state, ZIP or city, and name similarity.
// Writes data/processed/osha_plants.csv (ignored), osha_parents.csv and osha_summary.json.
// The step costs no Deepline credits.

import fs from 'node:fs';
import path from 'node:path';

const RAW = 'data/raw';
const OUT = 'data/processed';
const SINCE = '2023-11-01';
const API = 'https://labordata.bunkum.us/osha_enforcement.json';
const CACHE = path.join(RAW, 'osha_mfg_since_2023-11.json');

function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// 1. Pull OSHA inspections with citations (paged by activity number)
async function pullOsha() {
  if (fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const all = [];
  let last = 0;
  for (;;) {
    const sql = `select i.activity_nr, i.estab_name, i.site_city, i.site_state, i.site_zip, i.naics_code, i.open_date,
      count(*) viol_n,
      sum(case when v.viol_type in ('S','W','R') then 1 else 0 end) serious_n,
      sum(coalesce(v.current_penalty,0)) penalty
      from inspection i join violation v on v.activity_nr = i.activity_nr
      where i.open_date >= '${SINCE}' and i.naics_code >= 310000 and i.naics_code < 340000 and i.activity_nr > ${last}
      group by 1,2,3,4,5,6,7 order by 1 limit 1000`;
    const url = `${API}?${new URLSearchParams({ sql, _shape: 'array' })}`;
    let rows;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url);
      if (res.ok) { rows = await res.json(); break; }
      if (attempt >= 4) throw new Error(`OSHA mirror failed: HTTP ${res.status}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    all.push(...rows);
    if (rows.length < 1000) break;
    last = rows[rows.length - 1].activity_nr;
  }
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(all));
  return all;
}

// 2. Name and place normalization
const STOP = new Set(['INC', 'LLC', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LP', 'LLP', 'LTD', 'THE', 'AND', 'OF', 'PLANT', 'DIV', 'DIVISION', 'USA', 'US', 'AMERICA', 'AMERICAS', 'NORTH', 'GROUP', 'HOLDINGS', 'FACILITY']);
const tokens = (name) => new Set(
  String(name || '').toUpperCase().replace(/^\d{6,}\s*-\s*/, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/).filter((t) => t && !STOP.has(t)),
);
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};
const zip5 = (z) => String(z ?? '').replace(/\D/g, '').slice(0, 5).padStart(5, '0');
const cityKey = (c) => String(c || '').toUpperCase().replace(/[^A-Z ]/g, '').trim();

// A shared town name or trade word must not make two companies match (for example,
// "Lubrizol Deer Park" and "Deer Park Refining"). When two names share only town words and
// trade words, accept the match only if neither name has any other word. That keeps companies
// named after their town (Waupaca Foundry in Waupaca). This guard only removes matches.
const TRADE = new Set(['INDUSTRIES', 'INDUSTRIAL', 'PRODUCTS', 'MANUFACTURING', 'MFG', 'CHEMICAL', 'CHEMICALS', 'REFINING', 'GALVANIZING', 'FOUNDRY', 'SYSTEM', 'SYSTEMS', 'SERVICES', 'COMPANY', 'INTERNATIONAL', 'METALS', 'STEEL', 'PLASTICS', 'PACKAGING', 'MATERIALS', 'OPERATIONS', 'FOODS', 'FARMS', 'MILL', 'MILLS', 'FEED', 'COATING', 'COATINGS', 'TECHNOLOGIES', 'SOLUTIONS']);
const sameCompany = (x, y, cities) => {
  const town = new Set(cities.join(' ').split(' ').filter(Boolean));
  const own = (t) => !town.has(t) && !TRADE.has(t) && !/^\d+$/.test(t);
  if ([...x].some((t) => own(t) && y.has(t))) return true;
  return ![...x].some(own) && ![...y].some(own);
};

// 3. Load plants from step 01
const pr = parseCsv(fs.readFileSync(path.join(OUT, 'tri_shortlist_facilities.csv'), 'utf8'));
const ph = pr[0];
const g = (r, n) => r[ph.indexOf(n)];
const plants = pr.slice(1).filter((r) => r.length > 1).map((r) => ({
  trifd: g(r, 'trifd'), facility_name: g(r, 'facility_name'), city: g(r, 'city'), state: g(r, 'state'),
  zip: zip5(g(r, 'zip')), parent_name: g(r, 'parent_name'),
  toks: tokens(g(r, 'facility_name')), cityKey: cityKey(g(r, 'city')),
  inspections: 0, citations: 0, serious: 0, penalty: 0, weak: 0, osha_names: [], activity_nrs: [],
}));
const byZip = new Map(); const byCity = new Map();
const push = (m, k, p) => { if (!m.has(k)) m.set(k, []); m.get(k).push(p); };
for (const p of plants) { push(byZip, `${p.state}|${p.zip}`, p); push(byCity, `${p.state}|${p.cityKey}`, p); }

// 4. Match: each OSHA inspection goes to its best plant
const osha = await pullOsha();
let strong = 0; let weak = 0;
for (const o of osha) {
  const ot = tokens(o.estab_name);
  const z = zip5(o.site_zip); const c = cityKey(o.site_city);
  const cands = new Map();
  for (const p of byZip.get(`${o.site_state}|${z}`) || []) cands.set(p.trifd, { p, sameZip: true });
  for (const p of byCity.get(`${o.site_state}|${c}`) || []) if (!cands.has(p.trifd)) cands.set(p.trifd, { p, sameZip: false });
  let best = null;
  for (const { p, sameZip } of cands.values()) {
    const s = sameCompany(p.toks, ot, [c, p.cityKey]) ? jaccard(ot, p.toks) : 0;
    const isStrong = (sameZip && s >= 0.5) || (!sameZip && s >= 0.67);
    const isWeak = !isStrong && s >= 0.34;
    if (!isStrong && !isWeak) continue;
    const score = s + (sameZip ? 0.1 : 0) + (isStrong ? 1 : 0);
    if (!best || score > best.score) best = { p, score, isStrong };
  }
  if (!best) continue;
  if (best.isStrong) {
    strong++;
    best.p.inspections++; best.p.osha_names.push(o.estab_name); best.p.activity_nrs.push(o.activity_nr); best.p.citations += Number(o.viol_n) || 0;
    best.p.serious += Number(o.serious_n) || 0; best.p.penalty += Number(o.penalty) || 0;
  } else { weak++; best.p.weak++; }
}

// 5. Write outputs
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const pCols = ['trifd', 'facility_name', 'state', 'parent_name', 'inspections', 'citations', 'serious', 'penalty', 'weak', 'osha_names', 'activity_nrs'];
fs.writeFileSync(
  path.join(OUT, 'osha_plants.csv'),
  [pCols.join(','), ...plants.map((p) => pCols.map((c) => esc(Array.isArray(p[c]) ? p[c].join(c === 'activity_nrs' ? ' ' : ' | ') : p[c])).join(','))].join('\n'),
);
const parents = new Map();
for (const p of plants) {
  const a = parents.get(p.parent_name) || {
    parent_name: p.parent_name, plants: 0, plants_cited: 0, plants_serious: 0, citations: 0, serious_citations: 0, penalties_usd: 0,
  };
  a.plants++;
  if (p.citations > 0) a.plants_cited++;
  if (p.serious > 0) a.plants_serious++;
  a.citations += p.citations; a.serious_citations += p.serious; a.penalties_usd += p.penalty;
  parents.set(p.parent_name, a);
}
const list = [...parents.values()].sort((a, b) => b.plants_serious - a.plants_serious || b.plants - a.plants);
const aCols = ['parent_name', 'plants', 'plants_cited', 'plants_serious', 'citations', 'serious_citations', 'penalties_usd'];
fs.writeFileSync(
  path.join(OUT, 'osha_parents.csv'),
  [aCols.join(','), ...list.map((a) => aCols.map((c) => esc(Math.round(a[c]) === a[c] || typeof a[c] === 'string' ? a[c] : Math.round(a[c]))).join(','))].join('\n'),
);
const summary = {
  since: SINCE,
  osha_inspections_with_citations_pulled: osha.length,
  shortlist_plants: plants.length,
  inspections_matched_strong: strong,
  inspections_matched_weak_not_used: weak,
  plants_with_citation: plants.filter((p) => p.citations > 0).length,
  plants_with_serious_repeat_willful: plants.filter((p) => p.serious > 0).length,
  parents: list.length,
  parents_with_cited_plant: list.filter((a) => a.plants_cited > 0).length,
  parents_with_serious_plant: list.filter((a) => a.plants_serious > 0).length,
  parents_with_2plus_serious_plants: list.filter((a) => a.plants_serious >= 2).length,
};
fs.writeFileSync(path.join(OUT, 'osha_summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
