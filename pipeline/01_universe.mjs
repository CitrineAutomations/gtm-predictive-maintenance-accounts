// Step 01: build the plant and parent universe from EPA TRI Basic Data Files.
// Usage: node pipeline/01_universe.mjs [YEAR] [STATE ... | ALL]
// Example: node pipeline/01_universe.mjs 2024 OH TX
// Example: node pipeline/01_universe.mjs 2024 ALL
//
// Reads data/raw/tri_<year>_<state>.csv (downloads it when missing).
// Writes data/processed/<prefix>_facilities.csv, <prefix>_summary.json and
// <prefix>_shortlist_parents.csv. The prefix is "tri" for ALL and "pilot" otherwise.
// The shortlist keeps parents with at least MIN_PLANTS plants in the shortlist industries.
// Keeps only facility fields. It never writes the contact columns.

import fs from 'node:fs';
import path from 'node:path';

const year = process.argv[2] || '2024';
const ALL_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR'];
const args = process.argv.slice(3);
const isAll = args.length === 1 && args[0].toUpperCase() === 'ALL';
const states = isAll ? ALL_STATES : args.length ? args : ['OH', 'TX'];
const prefix = isAll ? 'tri' : 'pilot';
const MIN_PLANTS = 3;
// Shortlist industries: food, petroleum and coal products, chemicals, plastics,
// primary metals, fabricated metals, machinery, transportation equipment.
const SHORTLIST_NAICS3 = ['311', '324', '325', '326', '331', '332', '333', '336'];
const EXCLUDED_NAICS6 = ['324121', '324122']; // asphalt plants
const RAW = 'data/raw';
const OUT = 'data/processed';

fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

async function ensureFile(state) {
  const file = path.join(RAW, `tri_${year}_${state}.csv`);
  if (fs.existsSync(file)) return file;
  const url = `https://data.epa.gov/efservice/downloads/tri/mv_tri_basic_download/${year}_${state}/csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${state} ${year}: HTTP ${res.status}`);
  fs.writeFileSync(file, await res.text());
  return file;
}

// Small CSV parser that handles quoted fields, commas and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') { field += c; }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (v) => {
  const s = (v ?? '').trim().toUpperCase();
  return ['', 'NA', 'N/A', 'NONE', 'UNKNOWN'].includes(s) ? null : s;
};

const facilities = new Map(); // key: TRIFD
for (const state of states) {
  const file = await ensureFile(state);
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const header = rows[0].map((h) => h.replace(/^\d+\.\s*/, '').trim());
  const idx = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Column not found: ${name}`);
    return i;
  };
  const col = {
    trifd: idx('TRIFD'), frs: idx('FRS ID'), name: idx('FACILITY NAME'),
    city: idx('CITY'), county: idx('COUNTY'), st: idx('ST'), zip: idx('ZIP'),
    parent: idx('PARENT CO NAME'), stdParent: idx('STANDARD PARENT CO NAME'),
    naics: idx('PRIMARY NAICS'),
  };
  for (const r of rows.slice(1)) {
    const id = r[col.trifd];
    if (!id || facilities.has(id)) continue; // one row per facility, not per chemical
    const parentRaw = clean(r[col.parent]);
    const parentStd = clean(r[col.stdParent]);
    facilities.set(id, {
      trifd: id,
      frs_id: clean(r[col.frs]),
      facility_name: r[col.name].trim(),
      city: r[col.city].trim(),
      county: r[col.county].trim(),
      state: r[col.st].trim(),
      zip: r[col.zip].trim(),
      naics: (r[col.naics] || '').trim(),
      parent_name: parentStd || parentRaw,
      parent_source: parentStd ? 'standard' : parentRaw ? 'reported' : 'none',
    });
  }
}

const all = [...facilities.values()];
const mfg = all.filter((f) => /^3[123]/.test(f.naics));
const withParent = mfg.filter((f) => f.parent_name);

// Plants per parent
const perParent = new Map();
for (const f of withParent) perParent.set(f.parent_name, (perParent.get(f.parent_name) || 0) + 1);
const counts = [...perParent.values()];
const bucket = (lo, hi) => counts.filter((n) => n >= lo && n <= hi).length;

// NAICS 3-digit distribution (manufacturing only)
const naics3 = {};
for (const f of mfg) naics3[f.naics.slice(0, 3)] = (naics3[f.naics.slice(0, 3)] || 0) + 1;

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const summary = {
  year, states,
  facilities_total: all.length,
  facilities_manufacturing: mfg.length,
  manufacturing_with_parent: withParent.length,
  parent_match_rate_pct: pct(withParent.length, mfg.length),
  parent_source: {
    standard: mfg.filter((f) => f.parent_source === 'standard').length,
    reported: mfg.filter((f) => f.parent_source === 'reported').length,
    none: mfg.filter((f) => f.parent_source === 'none').length,
  },
  distinct_parents: perParent.size,
  frs_id_present_pct: pct(mfg.filter((f) => f.frs_id).length, mfg.length),
  parents_by_plant_count_in_sample: {
    '1': bucket(1, 1), '2-4': bucket(2, 4), '5-9': bucket(5, 9), '10+': bucket(10, Infinity),
  },
  top_parents: [...perParent.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([name, plants]) => ({ name, plants })),
  naics3_counts: Object.fromEntries(Object.entries(naics3).sort((a, b) => b[1] - a[1])),
};

// Shortlist: parents with at least MIN_PLANTS plants in the shortlist industries
const inShortlist = (f) => SHORTLIST_NAICS3.includes(f.naics.slice(0, 3)) && !EXCLUDED_NAICS6.includes(f.naics);
const shortlistByParent = new Map();
for (const f of withParent.filter(inShortlist)) {
  const e = shortlistByParent.get(f.parent_name) || { plants: 0, states: new Set(), naics3: new Set() };
  e.plants++; e.states.add(f.state); e.naics3.add(f.naics.slice(0, 3));
  shortlistByParent.set(f.parent_name, e);
}
const shortlist = [...shortlistByParent.entries()]
  .filter(([, e]) => e.plants >= MIN_PLANTS)
  .sort((a, b) => b[1].plants - a[1].plants);
summary.shortlist = {
  min_plants: MIN_PLANTS,
  parents_any: shortlistByParent.size,
  parents_kept: shortlist.length,
  parents_with_5_plus: shortlist.filter(([, e]) => e.plants >= 5).length,
  parents_with_10_plus: shortlist.filter(([, e]) => e.plants >= 10).length,
};

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cols = ['trifd', 'frs_id', 'facility_name', 'city', 'county', 'state', 'zip', 'naics', 'parent_name', 'parent_source'];
fs.writeFileSync(
  path.join(OUT, `${prefix}_facilities.csv`),
  [cols.join(','), ...mfg.map((f) => cols.map((c) => esc(f[c])).join(','))].join('\n'),
);
fs.writeFileSync(
  path.join(OUT, `${prefix}_shortlist_parents.csv`),
  [
    'parent_name,shortlist_plants,state_count,states,naics3_groups',
    ...shortlist.map(([name, e]) =>
      [esc(name), e.plants, e.states.size, esc([...e.states].sort().join(' ')), esc([...e.naics3].sort().join(' '))].join(',')),
  ].join('\n'),
);
const keptParents = new Set(shortlist.map(([name]) => name));
const keptPlants = withParent.filter((f) => inShortlist(f) && keptParents.has(f.parent_name));
fs.writeFileSync(
  path.join(OUT, `${prefix}_shortlist_facilities.csv`),
  [cols.join(','), ...keptPlants.map((f) => cols.map((c) => esc(f[c])).join(','))].join('\n'),
);
summary.shortlist.plants_kept = keptPlants.length;
fs.writeFileSync(path.join(OUT, `${prefix}_summary.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
