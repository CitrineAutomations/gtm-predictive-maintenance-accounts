// Step 02g: find equipment-related EPA violations at the plants of the 250 accounts, from EPA's bulk files.
// Usage: node pipeline/02g_epa_detail.mjs   (run steps 02b and 03b first)
//
// Inputs (data/raw, not committed), all from https://echo.epa.gov/files/echodownloads/:
//   echo_exporter.zip                 maps each plant's registry ID to its water, air and waste IDs
//   epa_bulk/npdes_eff_downloads.zip  water discharge results (about 16 GB unpacked)
//   epa_bulk/npdes_downloads.zip      water single events
//   epa_bulk/rcra_downloads.zip       hazardous waste violations
//   epa_bulk/ICIS-AIR_downloads.zip   air violations
// The script streams the files out of the zips with `unzip -p`. It costs nothing.
//
// "Equipment-related" is our own grouping and has not been tested against sales results:
//   water_limit   a discharge above the permit limit (code E90). Late or missing reports do not count.
//   water_bypass  a single event described as a bypass, overflow or spill
//   leak_tank     hazardous waste codes for process vents, equipment leaks, tanks and containers
//                 (40 CFR 264 or 265, subparts AA, BB, CC, J)
//   air_priority  an air "High Priority Violation": serious, but not always about equipment
// Violations dated 2023-11-01 or later count, the same window as the OSHA signal. A waste or air
// violation with no end date ("open") also counts when it is dated 2021-11-01 or later.
// Water breaches under an industrial or construction stormwater permit are counted apart, because
// rain runoff is not a process failure. Individual permits can also hold rain outfalls that this
// test does not see.
// "snc" is EPA's current serious-violator mark in the exporter file (waste or water significant
// noncompliance, or an air High Priority Violation).

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const OUT = 'data/processed';
const RAW = 'data/raw';
const BULK = path.join(RAW, 'epa_bulk');
const SINCE = new Date('2023-11-01');
const OPEN_SINCE = new Date('2021-11-01');

/** Quote-aware CSV records from a text stream. `keep` can reject a record early by its raw start. */
async function eachRecord(zip, member, onRecord, keep) {
  const proc = spawn('unzip', ['-p', zip, member], { stdio: ['ignore', 'pipe', 'inherit'] });
  proc.stdout.setEncoding('utf8');
  let buffer = ''; let header = null;
  const split = (line) => {
    const out = []; let f = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(f); f = ''; } else if (c !== '\r') f += c;
    }
    out.push(f); return out;
  };
  const quotesIn = (s) => { let n = 0; for (let i = s.indexOf('"'); i >= 0; i = s.indexOf('"', i + 1)) n++; return n; };
  let pending = '';
  const take = (line) => {
    const record = pending ? `${pending}\n${line}` : line;
    if (quotesIn(record) % 2 === 1) { pending = record; return; } // a quoted field holds a line break
    pending = '';
    if (!header) { header = split(record); return; }
    if (!record || (keep && !keep(record))) return;
    const values = split(record);
    onRecord(Object.fromEntries(header.map((h, i) => [h, values[i] ?? ''])));
  };
  for await (const chunk of proc.stdout) {
    buffer += chunk;
    let start = 0;
    for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n', start)) {
      take(buffer.slice(start, end));
      start = end + 1;
    }
    buffer = buffer.slice(start);
  }
  if (buffer) take(buffer);
  const code = proc.exitCode ?? await new Promise((resolve) => proc.on('close', resolve));
  if (code !== 0) throw new Error(`unzip failed for ${member}: exit ${code}`);
  if (!header) throw new Error(`no data in ${member}`);
}

function readCsv(file) {
  const rows = fs.readFileSync(path.join(OUT, file), 'utf8').split('\n').filter(Boolean).map((l) => {
    const out = []; let f = ''; let q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (q && l[i + 1] === '"') { f += '"'; i++; } else q = !q; } else if (c === ',' && !q) { out.push(f); f = ''; } else if (c !== '\r') f += c;
    }
    out.push(f); return out;
  });
  const h = rows.shift();
  return rows.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const writeCsv = (file, cols, rows) => fs.writeFileSync(path.join(OUT, file), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));

// 1. Plants of the 250 accounts.
const accounts = readCsv('accounts_250.csv');
const wanted = new Set(accounts.map((a) => a.legal_parent_name));
const plants = readCsv('tri_shortlist_facilities.csv').filter((p) => wanted.has(p.parent_name) && p.frs_id)
  .map((p) => ({ ...p, hits: { water_limit: new Map(), water_stormwater: new Map(), water_bypass: new Map(), leak_tank: new Map(), air_priority: new Map() }, snc: [], open: new Set() }));
const byRegistry = new Map();
for (const p of plants) byRegistry.set(p.frs_id, [...(byRegistry.get(p.frs_id) || []), p]);

// 2. Program IDs for each plant.
const ids = { water: new Map(), air: new Map(), waste: new Map() };
let found = 0;
await eachRecord(path.join(RAW, 'echo_exporter.zip'), 'ECHO_EXPORTER.csv', (r) => {
  const list = byRegistry.get(r.REGISTRY_ID);
  if (!list) return;
  found += 1;
  const marks = [['waste', r.RCRA_SNC_FLAG], ['water', r.CWA_SNC_FLAG], ['air', r.CAA_HPV_FLAG]].filter(([, v]) => v === 'Y').map(([k]) => k);
  for (const plant of list) plant.snc = marks;
  for (const [kind, column] of [['water', 'NPDES_IDS'], ['air', 'AIR_IDS'], ['waste', 'RCRA_IDS']]) {
    for (const id of String(r[column] || '').split(/\s+/).filter(Boolean)) ids[kind].set(id, list);
  }
});
console.log(`plants ${plants.length}, found in exporter ${found}, water IDs ${ids.water.size}, air IDs ${ids.air.size}, waste IDs ${ids.waste.size}`);

const firstField = (record) => record.slice(1, record.indexOf('"', 1));
const add = (list, kind, label, date) => {
  for (const plant of list) {
    const old = plant.hits[kind].get(label) || { n: 0, last: new Date(0) };
    plant.hits[kind].set(label, { n: old.n + 1, last: date > old.last ? date : old.last });
  }
};
const recent = (text) => { const d = new Date(text); return Number.isNaN(d.getTime()) || d < SINCE ? null : d; };

// Permits that cover stormwater from industry or construction.
const stormwater = new Set();
await eachRecord(path.join(BULK, 'npdes_downloads.zip'), 'NPDES_PERM_COMPONENTS.csv', (r) => {
  if (r.COMPONENT_TYPE_CODE === 'SWI' || r.COMPONENT_TYPE_CODE === 'SWC') stormwater.add(r.EXTERNAL_PERMIT_NMBR);
}, (record) => ids.water.has(firstField(record)));

// 3. Water: discharges above the permit limit.
await eachRecord(path.join(BULK, 'npdes_eff_downloads.zip'), 'NPDES_EFF_VIOLATIONS.csv', (r) => {
  const date = recent(r.MONITORING_PERIOD_END_DATE);
  if (date && r.VIOLATION_CODE === 'E90') add(ids.water.get(r.NPDES_ID), stormwater.has(r.NPDES_ID) ? 'water_stormwater' : 'water_limit', r.PARAMETER_DESC, date);
}, (record) => ids.water.has(firstField(record)));
console.log('water limits read');

// 4. Water: bypass, overflow and spill events.
await eachRecord(path.join(BULK, 'npdes_downloads.zip'), 'NPDES_SE_VIOLATIONS.csv', (r) => {
  const date = recent(r.SINGLE_EVENT_VIOLATION_DATE);
  if (date && /bypass|overflow|spill/i.test(r.VIOLATION_DESC)) add(ids.water.get(r.NPDES_ID), 'water_bypass', r.VIOLATION_DESC, date);
}, (record) => ids.water.has(firstField(record)));

// 5. Waste: leak and tank rules.
await eachRecord(path.join(BULK, 'rcra_downloads.zip'), 'RCRA_VIOLATIONS.csv', (r) => {
  if (!/^26[45]\.(AA|BB|CC|J)\b/.test(r.VIOLATION_TYPE)) return;
  const determined = new Date(r.DATE_VIOLATION_DETERMINED);
  const open = !r.ACTUAL_RTC_DATE && determined >= OPEN_SINCE;
  const date = open ? determined : recent(r.DATE_VIOLATION_DETERMINED);
  if (!date) return;
  add(ids.waste.get(r.ID_NUMBER), 'leak_tank', r.VIOLATION_TYPE_DESC, date);
  if (open) for (const plant of ids.waste.get(r.ID_NUMBER)) plant.open.add('leak_tank');
}, (record) => ids.waste.has(firstField(record)));

// 6. Air: High Priority Violations.
await eachRecord(path.join(BULK, 'ICIS-AIR_downloads.zip'), 'ICIS-AIR_VIOLATION_HISTORY.csv', (r) => {
  if (r.ENF_RESPONSE_POLICY_CODE !== 'HPV') return;
  const started = new Date(r.HPV_DAYZERO_DATE);
  const open = !r.HPV_RESOLVED_DATE && started >= OPEN_SINCE;
  const date = open ? started : recent(r.HPV_DAYZERO_DATE);
  if (!date) return;
  add(ids.air.get(r.PGM_SYS_ID), 'air_priority', r.POLLUTANT_DESCS || 'pollutant not listed', date);
  if (open) for (const plant of ids.air.get(r.PGM_SYS_ID)) plant.open.add('air_priority');
}, (record) => ids.air.has(firstField(record)));

// 7. Outputs.
const KINDS = ['water_limit', 'water_stormwater', 'water_bypass', 'leak_tank', 'air_priority'];
const describe = (map) => [...map].sort((a, b) => b[1].n - a[1].n)
  .map(([label, v]) => `${label} (${v.n}x, last ${v.last.toISOString().slice(0, 10)})`).join('; ');
const hit = plants.filter((p) => p.snc.length || KINDS.some((k) => p.hits[k].size));
writeCsv('epa_equipment_plants.csv', ['trifd', 'frs_id', 'parent_name', 'facility_name', 'city', 'state', ...KINDS, 'open_kinds', 'snc'],
  hit.map((p) => ({ ...p, ...Object.fromEntries(KINDS.map((k) => [k, describe(p.hits[k])])), open_kinds: [...p.open].join('; '), snc: p.snc.join('; ') })));

const equipment = (p) => p.hits.water_limit.size || p.hits.water_bypass.size || p.hits.leak_tank.size;
const times = (p, kind) => [...p.hits[kind].values()].reduce((n, v) => n + v.n, 0);
const byAccount = accounts.map((a) => {
  const mine = plants.filter((p) => p.parent_name === a.legal_parent_name);
  return {
    rank: Number(a.rank), account_name: a.account_name,
    ...Object.fromEntries(KINDS.map((k) => [`${k}_plants`, mine.filter((p) => p.hits[k].size).length])),
    equipment_plants: mine.filter(equipment).length,
    open_plants: mine.filter((p) => p.open.size).length,
    snc_plants: mine.filter((p) => p.snc.length).length,
    repeat_water_limit_plants: mine.filter((p) => times(p, 'water_limit') >= 3).length,
    equipment_or_air_priority_plants: mine.filter((p) => equipment(p) || p.hits.air_priority.size).length,
  };
});
writeCsv('epa_equipment_accounts.csv', Object.keys(byAccount[0]), byAccount);

const count = (f) => byAccount.filter(f).length;
const summary = {
  built_on: new Date().toISOString().slice(0, 10),
  violations_since: '2023-11-01',
  accounts: byAccount.length,
  plants_under_accounts: plants.length,
  plants_found_in_epa: found,
  plants: {
    ...Object.fromEntries(KINDS.map((k) => [k, plants.filter((p) => p.hits[k].size).length])),
    equipment_any: plants.filter(equipment).length,
    water_limit_3_or_more_times: plants.filter((p) => times(p, 'water_limit') >= 3).length,
  },
  accounts_with: {
    ...Object.fromEntries(KINDS.map((k) => [k, count((a) => a[`${k}_plants`] > 0)])),
    equipment_any: count((a) => a.equipment_plants > 0),
    water_limit_3_or_more_times: count((a) => a.repeat_water_limit_plants > 0),
    equipment_or_air_priority: count((a) => a.equipment_or_air_priority_plants > 0),
    equipment_at_2plus_plants: count((a) => a.equipment_plants >= 2),
    open_leak_tank_or_air: count((a) => a.open_plants > 0),
    snc: count((a) => a.snc_plants > 0),
    equipment_or_snc: count((a) => a.equipment_plants > 0 || a.snc_plants > 0),
  },
  plants_marked: {
    open_leak_tank_or_air: plants.filter((p) => p.open.size).length,
    snc: plants.filter((p) => p.snc.length).length,
  },
  top_25_with_equipment: count((a) => a.rank <= 25 && a.equipment_plants > 0),
};
fs.writeFileSync(path.join(OUT, 'epa_equipment_summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
