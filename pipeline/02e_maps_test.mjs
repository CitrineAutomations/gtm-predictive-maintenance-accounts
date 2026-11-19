// Step 02e: test how well Google Maps search finds plants that TRI lists, and plants that TRI misses.
// Usage:
//   node pipeline/02e_maps_test.mjs plan      writes data/raw/maps/queries.tsv (25 sampled parents)
//   (run each query with the Deepline CLI, see the shell loop in pipeline/README.md)
//   node pipeline/02e_maps_test.mjs analyze   reads data/raw/maps/*.json, writes maps_test_*.{csv,json}
//
// Tool: serper_google_maps_search (0.04 credits per result). One nationwide query for each parent.
// The analysis keeps title, address and type. It drops phone numbers and ratings.

import fs from 'node:fs';
import path from 'node:path';

const OUT = 'data/processed';
const DIR = 'data/raw/maps';
const SAMPLE = 25;
const mode = process.argv[2];

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const header = lines[0].split(',').map((h) => h.replace(/"/g, ''));
  return lines.slice(1).map((line) => {
    const v = line.match(/"[^"]*"|[^,]+/g) || [];
    return Object.fromEntries(header.map((h, i) => [h, (v[i] || '').replace(/^"|"$/g, '')]));
  });
}

const brand = (name) =>
  name.replace(/['’]/g, '').replace(/\b(INC|CORP|CORPORATION|LLC|CO|COMPANY|LP|LTD|HOLDINGS?|THE|INTERMEDIATE|OPERATIONS)\b/g, '')
    .replace(/\s+/g, ' ').trim();

const parents = readCsv(path.join(OUT, 'tri_shortlist_parents.csv'));

if (mode === 'plan') {
  const pool = parents.filter((p) => Number(p.shortlist_plants) >= 3 && Number(p.shortlist_plants) <= 9);
  const step = Math.floor(pool.length / SAMPLE);
  const sample = Array.from({ length: SAMPLE }, (_, i) => pool[i * step]);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DIR, 'queries.tsv'),
    sample.map((p, i) => `${i + 1}\t${p.parent_name}\t${brand(p.parent_name)} manufacturing plant`).join('\n'),
  );
  console.log(`Wrote ${sample.length} queries to ${path.join(DIR, 'queries.tsv')}`);
} else if (mode === 'analyze') {
  const queries = fs.readFileSync(path.join(DIR, 'queries.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => {
    const [i, parent, query] = l.split('\t');
    return { i, parent, query };
  });
  const plantRows = readCsv(path.join(OUT, 'tri_shortlist_facilities.csv'));
  const byParent = new Map();
  for (const p of plantRows) {
    if (!byParent.has(p.parent_name)) byParent.set(p.parent_name, []);
    byParent.get(p.parent_name).push(p);
  }
  const find = (o, d = 0) => {
    if (!o || typeof o !== 'object' || d > 6) return null;
    if (Array.isArray(o.places)) return o.places;
    for (const k in o) { const r = find(o[k], d + 1); if (r) return r; }
    return null;
  };
  const zip5 = (z) => String(z || '').replace(/\D/g, '').slice(0, 5).padStart(5, '0');
  const city = (c) => String(c || '').toUpperCase().replace(/[^A-Z ]/g, '').trim();
  const parseAddr = (a) => {
    const m = String(a || '').match(/,\s*([^,]+),\s*([A-Z]{2})\s*(\d{5})?/);
    return m ? { city: city(m[1]), state: m[2], zip: m[3] || '' } : null;
  };
  const tokens = (s) => new Set(String(s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 2));
  const rows = []; const sites = [];
  for (const q of queries) {
    const file = path.join(DIR, `${q.i}.json`);
    if (!fs.existsSync(file)) { rows.push({ ...q, status: 'not run' }); continue; }
    const places = find(JSON.parse(fs.readFileSync(file, 'utf8'))) || [];
    const tri = byParent.get(q.parent) || [];
    const brandTokens = tokens(brand(q.parent));
    let matched = 0; const usedTri = new Set(); const local = [];
    for (const pl of places) {
      const a = parseAddr(pl.address);
      const nameHit = [...tokens(pl.title)].some((t) => brandTokens.has(t));
      const hit = a && tri.find((t) => !usedTri.has(t.trifd) && t.state === a.state && (zip5(t.zip) === a.zip || city(t.city) === a.city));
      if (hit) { usedTri.add(hit.trifd); matched++; }
      const site = {
        parent_name: q.parent, title: pl.title, address: pl.address, type: pl.type || '',
        name_matches_brand: nameHit ? 1 : 0, in_tri: hit ? 1 : 0,
      };
      sites.push(site); local.push(site);
    }
    const named = places.filter((pl) => [...tokens(pl.title)].some((t) => brandTokens.has(t)));
    rows.push({
      ...q, status: 'ok', tri_plants: tri.length, maps_places: places.length, maps_name_match: named.length,
      tri_found_by_maps: matched, maps_sites_not_in_tri: local.filter((x) => x.name_matches_brand && !x.in_tri).length,
    });
  }
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rc = ['i', 'parent', 'query', 'status', 'tri_plants', 'maps_places', 'maps_name_match', 'tri_found_by_maps', 'maps_sites_not_in_tri'];
  fs.writeFileSync(path.join(OUT, 'maps_test_parents.csv'), [rc.join(','), ...rows.map((r) => rc.map((c) => esc(r[c])).join(','))].join('\n'));
  const sc = ['parent_name', 'title', 'address', 'type', 'name_matches_brand', 'in_tri'];
  fs.writeFileSync(path.join(OUT, 'maps_test_sites.csv'), [sc.join(','), ...sites.map((r) => sc.map((c) => esc(r[c])).join(','))].join('\n'));
  const ok = rows.filter((r) => r.status === 'ok');
  const sum = (k) => ok.reduce((a, r) => a + (r[k] || 0), 0);
  const summary = {
    parents_tested: ok.length,
    tri_plants_total: sum('tri_plants'),
    maps_places_total: sum('maps_places'),
    maps_places_matching_brand: sum('maps_name_match'),
    tri_plants_found_by_maps: sum('tri_found_by_maps'),
    maps_brand_sites_not_in_tri: sum('maps_sites_not_in_tri'),
    parents_with_zero_brand_match: ok.filter((r) => r.maps_name_match === 0).length,
  };
  fs.writeFileSync(path.join(OUT, 'maps_test_summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.error('Usage: node pipeline/02e_maps_test.mjs plan|analyze');
  process.exit(1);
}
