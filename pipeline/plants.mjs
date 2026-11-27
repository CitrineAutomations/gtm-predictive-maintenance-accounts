// Shared by steps 04a and 04c: read the account files and pick the start plant.
import fs from 'node:fs';
import path from 'node:path';

export const SOURCE = process.env.PIPELINE_DIR || '.';

export function readCsv(file) {
  const rows = fs.readFileSync(path.join(SOURCE, file), 'utf8').split('\n').filter(Boolean).map((l) => {
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

let cache;
function inputs() {
  cache ||= {
    osha: new Map(readCsv('data/processed/osha_plants.csv').map((r) => [r.trifd, r])),
    machine: new Map(JSON.parse(fs.readFileSync(path.join(SOURCE, 'data/raw/osha_machine_viol_since_2023-11.json'), 'utf8'))
      .map((r) => [String(r.activity_nr), Number(r.integrity)])),
    facilities: readCsv('data/processed/tri_shortlist_facilities.csv'),
    rules: JSON.parse(fs.readFileSync('pipeline/owner_splits.json', 'utf8')),
  };
  return cache;
}

/**
 * Up to 3 plants with a serious OSHA citation, mechanical integrity first. Sold plants are left out.
 * The CRM counts cited items and can choose a different plant. Check the CRM card before the brief.
 */
export function candidatePlants(account) {
  const { osha, machine, facilities, rules } = inputs();
  const split = rules.splits[account.legal_parent_name];
  const sold = (p) => split?.exclude?.some((x) => (x.trifd ? x.trifd === p.trifd : new RegExp(x.pattern).test(p.facility_name)));
  return facilities
    .filter((p) => p.parent_name === account.legal_parent_name && !sold(p))
    .map((p) => {
      const o = osha.get(p.trifd);
      const hits = String(o?.activity_nrs || '').split(' ').filter((x) => machine.has(x));
      return {
        trifd: p.trifd, facility: p.facility_name, city: p.city, state: p.state,
        business: split?.businesses.find((x) => new RegExp(x.pattern).test(p.facility_name))?.name || '',
        integrity: hits.filter((x) => machine.get(x)).length, machine: hits.length, serious: Number(o?.serious || 0),
      };
    })
    .filter((p) => p.serious > 0)
    .sort((a, b) => b.integrity - a.integrity || b.machine - a.machine || b.serious - a.serious)
    .slice(0, 3);
}

// ---- Does a result talk about this company? ----

const STOP = new Set(['INC', 'CORP', 'CORPORATION', 'LLC', 'CO', 'COMPANY', 'LP', 'LTD', 'HOLDING', 'HOLDINGS', 'THE', 'INTERMEDIATE', 'OPERATIONS', 'USA', 'US', 'AND', 'OF']);
// First words that many companies share. They cannot identify a company on their own.
const COMMON = new Set(['AMERICAN', 'GENERAL', 'NATIONAL', 'UNITED', 'DAIRY', 'FIRST', 'GLOBAL', 'INTERNATIONAL', 'STANDARD', 'SOUTHERN', 'NORTHERN', 'WESTERN', 'EASTERN', 'CENTRAL', 'PACIFIC', 'ATLANTIC']);
const clean = (s) => ` ${String(s).toUpperCase().replace(/['’]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim()} `;
export const brandTokens = (name) => clean(name).split(' ').filter((t) => t.length > 1 && !STOP.has(t));

/**
 * True when the text holds most words of the name. News often shortens a name, so the first word
 * and the plant city together also count ("Valero" and "Ardmore").
 */
export function namesCompany(name, city, text) {
  const tokens = brandTokens(name);
  const t = clean(text);
  const need = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.67);
  if (tokens.filter((x) => t.includes(x)).length >= need) return true;
  const [first] = tokens;
  return Boolean(first && city && first.length >= 5 && !COMMON.has(first) && t.includes(` ${first} `) && t.includes(clean(city)));
}
