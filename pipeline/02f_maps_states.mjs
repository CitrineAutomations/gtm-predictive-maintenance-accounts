// Step 02f: find plants with Google Maps, one query for each state where the parent has TRI plants.
// Usage:
//   node pipeline/02f_maps_states.mjs plan [PARENT ...]   writes data/raw/maps_states/queries.tsv
//   (run each query with the Deepline CLI, see the loop in pipeline/README.md)
//   node pipeline/02f_maps_states.mjs analyze             writes data/processed/maps_states_*.{csv,json}
//
// Tool: serper_google_maps_search. The test in step 02e fits 0.04 credits for each query that returns places.
// The default test parents are five parents from the 02e sample that had real plants.
// The output keeps title, address and type. It drops phone numbers and ratings.

import fs from 'node:fs';
import path from 'node:path';

const OUT = 'data/processed';
const DIR = 'data/raw/maps_states';
const MAX_STATES = 4;
const DEFAULT_PARENTS = ['BELGIOIOSO CHEESE INC', 'VOYANT BEAUTY HOLDINGS INC', 'SCOT INDUSTRIES INC', 'VICTAULIC CO', 'WACKER CHEMICAL CORP'];
const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'Washington DC', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico' };

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const header = lines[0].split(',').map((h) => h.replace(/"/g, ''));
  return lines.slice(1).map((line) => {
    const v = line.match(/"[^"]*"|[^,]+/g) || [];
    return Object.fromEntries(header.map((h, i) => [h, (v[i] || '').replace(/^"|"$/g, '')]));
  });
}
const STOP = /\b(INC|CORP|CORPORATION|LLC|CO|COMPANY|LP|LTD|HOLDINGS?|THE|INTERMEDIATE|OPERATIONS)\b/g;
const STOP_WORD = /^(INC|CORP|CORPORATION|LLC|CO|COMPANY|LP|LTD|HOLDING|HOLDINGS|THE|INTERMEDIATE|OPERATIONS)$/;
const brand = (n) => n.replace(/['’]/g, '').replace(STOP, '').replace(/\s+/g, ' ').trim();

const plants = readCsv(path.join(OUT, 'tri_shortlist_facilities.csv'));
const mode = process.argv[2];

if (mode === 'plan') {
  const parents = process.argv.length > 3 ? process.argv.slice(3) : DEFAULT_PARENTS;
  const lines = []; let i = 0;
  for (const parent of parents) {
    const counts = new Map();
    for (const p of plants) if (p.parent_name === parent) counts.set(p.state, (counts.get(p.state) || 0) + 1);
    const states = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_STATES).map(([s]) => s);
    for (const st of states) lines.push(`${++i}\t${parent}\t${st}\t${brand(parent)} manufacturing plant ${STATE_NAMES[st] || st}`);
  }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'queries.tsv'), lines.join('\n'));
  console.log(`${lines.length} queries written to ${path.join(DIR, 'queries.tsv')}`);
} else if (mode === 'analyze') {
  const qs = fs.readFileSync(path.join(DIR, 'queries.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => {
    const [i, parent, state, query] = l.split('\t'); return { i, parent, state, query };
  });
  const find = (o, d = 0) => {
    if (!o || typeof o !== 'object' || d > 6) return null;
    if (Array.isArray(o.places)) return o.places;
    for (const k in o) { const r = find(o[k], d + 1); if (r) return r; }
    return null;
  };
  const zip5 = (z) => String(z || '').replace(/\D/g, '').slice(0, 5).padStart(5, '0');
  const cityKey = (c) => String(c || '').toUpperCase().replace(/[^A-Z ]/g, '').trim();
  const parseAddr = (a) => {
    const m = String(a || '').match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})?/);
    return m ? { city: cityKey(m[1]), state: m[2], zip: m[3] || '' } : null;
  };
  const tok = (s) => new Set(String(s).toUpperCase().replace(/['’]/g, '').replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 2 && !STOP_WORD.test(t)));
  const rows = []; const sites = [];
  for (const q of qs) {
    const file = path.join(DIR, `${q.i}.json`);
    if (!fs.existsSync(file)) { rows.push({ ...q, status: 'not run' }); continue; }
    const places = find(JSON.parse(fs.readFileSync(file, 'utf8'))) || [];
    const tri = plants.filter((p) => p.parent_name === q.parent && p.state === q.state);
    const bt = tok(brand(q.parent));
    const used = new Set(); let matched = 0; let newSites = 0; let inState = 0;
    for (const pl of places) {
      const a = parseAddr(pl.address);
      const nameHit = [...tok(pl.title)].filter((t) => bt.has(t)).length >= Math.min(2, bt.size);
      if (a && a.state === q.state) inState++;
      const hit = a && tri.find((t) => !used.has(t.trifd) && (zip5(t.zip) === a.zip || cityKey(t.city) === a.city));
      if (hit) { used.add(hit.trifd); matched++; }
      else if (nameHit && a && a.state === q.state) newSites++;
      sites.push({ parent_name: q.parent, query_state: q.state, title: pl.title, address: pl.address, type: pl.type || '', name_match: nameHit ? 1 : 0, in_tri: hit ? 1 : 0 });
    }
    rows.push({ ...q, status: 'ok', tri_plants_in_state: tri.length, maps_places: places.length, maps_in_state: inState, tri_found: matched, new_named_sites: newSites });
  }
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rc = ['i', 'parent', 'state', 'status', 'tri_plants_in_state', 'maps_places', 'maps_in_state', 'tri_found', 'new_named_sites'];
  fs.writeFileSync(path.join(OUT, 'maps_states_queries.csv'), [rc.join(','), ...rows.map((r) => rc.map((c) => esc(r[c])).join(','))].join('\n'));
  const sc = ['parent_name', 'query_state', 'title', 'address', 'type', 'name_match', 'in_tri'];
  fs.writeFileSync(path.join(OUT, 'maps_states_sites.csv'), [sc.join(','), ...sites.map((r) => sc.map((c) => esc(r[c])).join(','))].join('\n'));
  const ok = rows.filter((r) => r.status === 'ok');
  const sum = (k) => ok.reduce((a, r) => a + (r[k] || 0), 0);
  const summary = {
    queries_run: ok.length, tri_plants_in_queried_states: sum('tri_plants_in_state'), maps_places: sum('maps_places'),
    tri_plants_found_by_maps: sum('tri_found'), named_sites_not_in_tri: sum('new_named_sites'),
  };
  fs.writeFileSync(path.join(OUT, 'maps_states_summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.error('Usage: node pipeline/02f_maps_states.mjs plan|analyze');
  process.exit(1);
}
