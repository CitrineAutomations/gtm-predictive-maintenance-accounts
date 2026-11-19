// Step 01: build the plant and parent universe from EPA TRI Basic Data Files.
// Usage: node pipeline/01_universe.mjs [YEAR] [STATE ...]
// Example: node pipeline/01_universe.mjs 2024 OH TX
//
// Reads data/raw/tri_<year>_<state>.csv (downloads it when missing).
// Writes data/processed/pilot_facilities.csv and data/processed/pilot_summary.json.
// Keeps only facility fields. It never writes the contact columns.

import fs from 'node:fs';
import path from 'node:path';

const year = process.argv[2] || '2024';
const states = process.argv.length > 3 ? process.argv.slice(3) : ['OH', 'TX'];
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

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cols = ['trifd', 'frs_id', 'facility_name', 'city', 'county', 'state', 'zip', 'naics', 'parent_name', 'parent_source'];
fs.writeFileSync(
  path.join(OUT, 'pilot_facilities.csv'),
  [cols.join(','), ...mfg.map((f) => cols.map((c) => esc(f[c])).join(','))].join('\n'),
);
fs.writeFileSync(path.join(OUT, 'pilot_summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
