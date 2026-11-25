// Step 03b: pick 250 accounts that have the OSHA signal.
// Usage: node pipeline/03b_select.mjs   (run steps 02b and 02c first)
//
// An account is a parent company. For the owners listed in pipeline/owner_splits.json, the row also
// names the businesses under the parent that have the OSHA signal, best first. Sold plants do not count.
// Gates: 3 or more shortlist plants, plants in 2 or more states, at least 1 plant with the OSHA signal.
// Order: plants with a mechanical integrity citation, then plants with any machine citation,
// then plants with any serious citation, then number of states, then name.
// "Machine citation" = serious, repeat or willful violation of lockout/tagout (1910.147),
// machine guarding (1910.212), power transmission guarding (1910.219) or mechanical
// integrity (1910.119(j)). The order is a hypothesis. Nobody has tested it against sales results.
// Source: the labordata.bunkum.us mirror (third party). The step costs no Deepline credits.

import fs from 'node:fs';
import path from 'node:path';

const OUT = 'data/processed';
const CACHE = 'data/raw/osha_machine_viol_since_2023-11.json';
const API = 'https://labordata.bunkum.us/osha_enforcement.json';
const SIZE = 250;

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
const writeCsv = (file, cols, rows) => fs.writeFileSync(
  path.join(OUT, file),
  [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'),
);

async function pullMachine() {
  if (fs.existsSync(CACHE)) return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const all = []; let last = 0;
  for (;;) {
    const sql = `select i.activity_nr,
      max(case when v.standard like '19100119 J%' then 1 else 0 end) integrity
      from inspection i join violation v on v.activity_nr = i.activity_nr
      where i.open_date >= '2023-11-01' and i.naics_code >= 310000 and i.naics_code < 340000
      and v.viol_type in ('S','W','R') and i.activity_nr > ${last}
      and (v.standard like '19100147%' or v.standard like '19100212%' or v.standard like '19100219%' or v.standard like '19100119 J%')
      group by 1 order by 1 limit 1000`;
    const res = await fetch(`${API}?${new URLSearchParams({ sql, _shape: 'array' })}`);
    if (!res.ok) throw new Error(`OSHA mirror failed: HTTP ${res.status}`);
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < 1000) break;
    last = rows[rows.length - 1].activity_nr;
  }
  fs.writeFileSync(CACHE, JSON.stringify(all));
  return all;
}

const machine = new Map((await pullMachine()).map((r) => [String(r.activity_nr), Number(r.integrity)]));
const rules = JSON.parse(fs.readFileSync('pipeline/owner_splits.json', 'utf8'));
const osha = new Map(readCsv('osha_plants.csv').map((r) => [r.trifd, r]));
const echo = new Map(readCsv('echo_plants.csv').map((r) => [r.trifd, r]));

// One account = one parent company. Businesses stay underneath as a hint for where to start.
const accounts = new Map();
const notAssigned = [];
for (const plant of readCsv('tri_shortlist_facilities.csv')) {
  const owner = plant.parent_name;
  const split = rules.splits[owner];
  const sold = (split?.exclude || []).find((x) => new RegExp(x.pattern).test(plant.facility_name));
  if (sold) {
    notAssigned.push({ owner_name: owner, facility_name: plant.facility_name, state: plant.state, reason: sold.reason });
    continue;
  }
  const biz = split?.businesses.find((x) => new RegExp(x.pattern).test(plant.facility_name));
  if (split && !biz) notAssigned.push({ owner_name: owner, facility_name: plant.facility_name, state: plant.state, reason: 'No business assigned' });
  const a = accounts.get(owner) || {
    account_name: rules.rename[owner] || owner, legal_parent_name: owner, businesses: new Map(),
    plants: 0, states: new Set(), integrity_plants: 0, machine_plants: 0, serious_plants: 0, epa_plants: 0,
  };
  const o = osha.get(plant.trifd);
  const hits = String(o?.activity_nrs || '').split(' ').filter((x) => machine.has(x));
  const integrity = hits.some((x) => machine.get(x)) ? 1 : 0;
  const serious = Number(o?.serious || 0) > 0 ? 1 : 0;
  a.plants++;
  a.states.add(plant.state);
  a.machine_plants += hits.length ? 1 : 0;
  a.integrity_plants += integrity;
  a.serious_plants += serious;
  if (Number(echo.get(plant.trifd)?.FAC_QTRS_WITH_NC || 0) >= 4) a.epa_plants++;
  if (biz && serious) {
    const b = a.businesses.get(biz.name) || [0, 0, 0];
    a.businesses.set(biz.name, [b[0] + integrity, b[1] + (hits.length ? 1 : 0), b[2] + serious]);
  }
  accounts.set(owner, a);
}

const ownerStyle = /\b(HOLDINGS?|CAPITAL|PARTNERS|LP)\b/;
const pool = [...accounts.values()]
  .map((a) => ({
    ...a,
    states: a.states.size,
    businesses: [...a.businesses].sort(([, x], [, y]) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2]).map(([n]) => n).join('; '),
    review_note: rules.review[a.legal_parent_name]
      || (ownerStyle.test(a.legal_parent_name) ? 'Owner-style legal name. Check who buys.' : ''),
  }))
  .filter((a) => a.plants >= 3 && a.states >= 2 && a.serious_plants > 0)
  .sort((a, b) => b.integrity_plants - a.integrity_plants || b.machine_plants - a.machine_plants
    || b.serious_plants - a.serious_plants || b.states - a.states || a.account_name.localeCompare(b.account_name));

const picked = pool.slice(0, SIZE).map((a, i) => ({ rank: i + 1, ...a }));
writeCsv('accounts_250.csv', Object.keys(picked[0]), picked);
writeCsv('accounts_unassigned_plants.csv', ['owner_name', 'facility_name', 'state', 'reason'], notAssigned);

const count = (f) => picked.filter(f).length;
const summary = {
  pool_accounts: pool.length,
  picked: picked.length,
  with_businesses_listed: count((a) => a.businesses),
  with_integrity_citation: count((a) => a.integrity_plants > 0),
  with_machine_citation: count((a) => a.machine_plants > 0),
  without_machine_citation: count((a) => !a.machine_plants),
  also_epa: count((a) => a.epa_plants > 0),
  with_review_note: count((a) => a.review_note),
  plants_3_to_4: count((a) => a.plants <= 4),
  plants_5_to_9: count((a) => a.plants >= 5 && a.plants <= 9),
  plants_10_plus: count((a) => a.plants >= 10),
  plants_under_the_250: picked.reduce((n, a) => n + a.plants, 0),
  plants_with_serious_under_the_250: picked.reduce((n, a) => n + a.serious_plants, 0),
  plants_sold_or_without_a_business: notAssigned.length,
};
fs.writeFileSync(path.join(OUT, 'accounts_250_summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
