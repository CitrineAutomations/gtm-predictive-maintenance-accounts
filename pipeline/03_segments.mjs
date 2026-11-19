// Step 03: tag each shortlist parent with segment flags and count the overlap.
// Usage: node pipeline/03_segments.mjs
//
// Reads tri_shortlist_parents.csv, echo_parents.csv and osha_parents.csv from data/processed/.
// Writes data/processed/segments.csv (one row per parent) and segments_summary.json.
//
// Segment rules (hypotheses, not proven drivers):
//   epa  = at least 1 plant with 4 or more quarters of non-compliance in the last 12 quarters (ECHO)
//   osha = at least 1 plant with a serious, repeat or willful citation since 2023-11-01 (OSHA)
// The hiring segment is not here yet. Step 02 ran on 24 parents only.

import fs from 'node:fs';
import path from 'node:path';

const OUT = 'data/processed';
const EPA_MIN_PLANTS = 1;
const OSHA_MIN_PLANTS = 1;

function readCsv(file) {
  const lines = fs.readFileSync(path.join(OUT, file), 'utf8').split('\n').filter(Boolean);
  const header = lines[0].split(',').map((h) => h.replace(/"/g, ''));
  return lines.slice(1).map((line) => {
    const v = line.match(/"[^"]*"|[^,]+/g) || [];
    return Object.fromEntries(header.map((h, i) => [h, (v[i] || '').replace(/^"|"$/g, '')]));
  });
}

const echo = new Map(readCsv('echo_parents.csv').map((r) => [r.parent_name, r]));
const osha = new Map(readCsv('osha_parents.csv').map((r) => [r.parent_name, r]));
const parents = readCsv('tri_shortlist_parents.csv').map((t) => {
  const e = echo.get(t.parent_name);
  const o = osha.get(t.parent_name);
  const epaPlants = Number(e?.plants_nc_4plus_qtrs || 0);
  const oshaPlants = Number(o?.plants_serious || 0);
  return {
    parent_name: t.parent_name,
    shortlist_plants: Number(t.shortlist_plants),
    state_count: Number(t.state_count),
    epa_plants: epaPlants,
    osha_plants: oshaPlants,
    epa: epaPlants >= EPA_MIN_PLANTS ? 1 : 0,
    osha: oshaPlants >= OSHA_MIN_PLANTS ? 1 : 0,
  };
});

const count = (f) => parents.filter(f).length;
const share = (list) => (list.length ? Math.round((100 * list.filter((p) => p.epa).length) / list.length) : 0);
const bucket = (lo, hi) => parents.filter((p) => p.shortlist_plants >= lo && p.shortlist_plants <= hi);
const oshaShare = (list) => (list.length ? Math.round((100 * list.filter((p) => p.osha).length) / list.length) : 0);
const buckets = { '3-4': bucket(3, 4), '5-9': bucket(5, 9), '10+': bucket(10, Infinity) };

const summary = {
  parents: parents.length,
  epa_only: count((p) => p.epa && !p.osha),
  osha_only: count((p) => !p.epa && p.osha),
  both: count((p) => p.epa && p.osha),
  neither: count((p) => !p.epa && !p.osha),
  epa_total: count((p) => p.epa),
  osha_total: count((p) => p.osha),
  share_by_plant_count: Object.fromEntries(
    Object.entries(buckets).map(([k, list]) => [k, { parents: list.length, epa_pct: share(list), osha_pct: oshaShare(list) }]),
  ),
};

const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
const cols = ['parent_name', 'shortlist_plants', 'state_count', 'epa_plants', 'osha_plants', 'epa', 'osha'];
fs.writeFileSync(
  path.join(OUT, 'segments.csv'),
  [cols.join(','), ...parents.map((p) => cols.map((c) => (c === 'parent_name' ? esc(p[c]) : p[c])).join(','))].join('\n'),
);
fs.writeFileSync(path.join(OUT, 'segments_summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
