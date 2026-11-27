// Step 04f: free contact search for every company on the contact list.
// For each company: find a website domain with a Keenable search, then ask Deepline search_contact for
// plant and maintenance titles. Pick at most one plant and one maintenance person, in the start plant
// city first and then in the same state. No email lookup happens here.
//
// Usage:
//   node pipeline/04f_contact_search.mjs run     search and pick. A second run continues.
//   node pipeline/04f_contact_search.mjs gaps    one more free pass for companies with no one picked
//   node pipeline/04f_contact_search.mjs pick    rebuild contacts.csv from saved results. No network.
//
// Every output holds names of people and goes to data/contacts/enrichment/, which Git ignores.
// search_contact runs with free_only, so it never charges credits. It stops when the allowance is nearly gone.

import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readCsv, candidatePlants, brandTokens } from './plants.mjs';

const exec = promisify(execFile);
const DIR = path.resolve(fs.existsSync('../../data/contacts') ? '../../data/contacts/enrichment' : 'data/contacts/enrichment');
const DL = path.join(DIR, 'dl');
const TMP = path.join(DIR, 'tmp');
const CONTACTS = path.join(DIR, 'contacts.csv');
const PAGE_SIZE = 10; // small pages, so the free allowance reaches all companies
const MAX_PAGES = 1;
const PAUSE_MS = 4200; // 15 requests a minute

const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico' };
const TITLES = ['Plant Manager', 'Site Director', 'Site Manager', 'Director of Operations', 'Operations Manager', 'Maintenance Manager', 'Maintenance Superintendent', 'Maintenance Supervisor', 'Reliability Manager', 'Reliability Engineer'];
// role, wanted title, rank of the title (1 = target, 2 = lower or wider than target)
const ROLES = [
  ['plant', /\b(plant (general )?manager|plant director|plant superintendent|site director|site manager|site leader|director of operations)\b/i, 1],
  ['plant', /\boperations manager\b/i, 2],
  ['maintenance', /\b(maintenance (and reliability )?(manager|superintendent)|(manager|director|superintendent),? (of )?maintenance|reliability manager)\b/i, 1],
  ['maintenance', /\b(maintenance supervisor|reliability engineer)\b/i, 2],
];
const NOT_A_FIT = /\b(assistant|former|retired|intern|trainee|sales|account|software|it\b|hr\b)/i;
const SKIP_SITES = /wikipedia|linkedin|facebook|bloomberg|crunchbase|zoominfo|dnb\.com|pitchbook|yahoo|reuters|indeed|glassdoor|yellowpages|mapquest|sec\.gov|youtube|instagram|x\.com|prnewswire|businesswire|manta\.com/i;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const squash = (s) => String(s || '').toLowerCase().replace(/\bsaint\b/g, 'st').replace(/[^a-z0-9]/g, '');
const GENERIC = new Set(['AMERICAN', 'GENERAL', 'NATIONAL', 'UNITED', 'GLOBAL', 'INTERNATIONAL', 'NORTH', 'AMERICA', 'GROUP', 'PRODUCTS', 'INDUSTRIES', 'MANUFACTURING', 'FIRST', 'STANDARD']);
const cleanName = (s) => brandTokens(s).join(' ');

// ---- the work list ----

const accounts = new Map([...readCsv('data/processed/accounts_250.csv'), ...readCsv('data/processed/accounts_extra.csv')].map((a) => [a.rank, a]));
const targets = readCsv('data/processed/contact_list.csv').filter((r) => r.list_status === 'include').map((r) => {
  const plants = candidatePlants(accounts.get(r.rank));
  const plant = plants.find((p) => squash(p.city) === squash(r.plant_city)) || plants[0];
  return { rank: r.rank, parent: r.legal_parent_name, name: plant.business || r.account_name, facility: plant.facility, city: r.plant_city, state: r.plant_state };
});
// Plant cities that the checks found closed. A person there is not picked.
const closed = new Map();
for (const r of readCsv('data/processed/backup_plant_check.csv')) if (r.result === 'closed') closed.set(r.account_name, [...(closed.get(r.account_name) || []), squash(r.city)]);
const closedFor = (rank) => closed.get(accounts.get(rank).account_name) || [];

// ---- picking ----

function candidates(target, persons) {
  const brand = [...brandTokens(target.name), ...brandTokens(target.facility)].filter((t) => t.length >= 3 && !GENERIC.has(t)).map(squash);
  const out = [];
  for (const p of persons) {
    const title = p.title || '';
    const match = ROLES.find(([, re]) => re.test(title));
    if (!match || NOT_A_FIT.test(title) || !p.first_name || !p.last_name) continue;
    const [city = '', state = ''] = String(p.location || '').split(',').map((x) => x.trim());
    if (state !== STATES[target.state] || closedFor(target.rank).includes(squash(city))) continue;
    // A name search can return another company with a similar name.
    if (p.by_name && !brand.some((b) => squash(`${p.company_name} ${p.company_domain}`).includes(b))) continue;
    out.push({ p, role: match[0], level: match[2], site: squash(city) === squash(target.city) ? 'city' : 'state' });
  }
  return out.sort((a, b) => (a.site === 'city' ? 0 : 1) - (b.site === 'city' ? 0 : 1) || a.level - b.level);
}

function pick(target, persons) {
  const all = candidates(target, persons);
  return ['plant', 'maintenance'].map((role) => all.find((c) => c.role === role)).filter(Boolean);
}

const COLS = ['rank', 'legal_parent_name', 'first_name', 'last_name', 'role', 'title', 'email', 'email_validation_status', 'domain', 'linkedin_url', 'location', 'site_match', 'source', 'note'];

function writeContacts() {
  // Keep rows picked by hand in the pilot, and any email already found.
  const old = fs.existsSync(CONTACTS) ? readCsv(path.relative(process.cwd(), CONTACTS)) : [];
  const saved = new Map(old.map((r) => [`${r.rank}|${r.role}`, r]));
  const done = new Set();
  const rows = [];
  for (const t of targets) {
    const file = path.join(DL, `${t.rank}.json`);
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : null;
    if (!data?.searched_by) continue; // pilot file or not searched
    done.add(t.rank);
    for (const c of pick(t, data.persons)) {
      const prior = saved.get(`${t.rank}|${c.role}`);
      const notes = [];
      if (c.site === 'state') notes.push(`${String(c.p.location).split(',')[0]}, not ${t.city}.`);
      if (c.level === 2) notes.push('Title is lower or wider than the target.');
      rows.push({ rank: t.rank, legal_parent_name: t.parent, first_name: c.p.first_name, last_name: c.p.last_name, role: c.role, title: c.p.title,
        email: prior?.linkedin_url === c.p.linkedin_url ? prior.email : '', email_validation_status: prior?.linkedin_url === c.p.linkedin_url ? prior.email_validation_status : '',
        domain: (/linktr[.]ee/.test(c.p.company_domain || '') ? '' : c.p.company_domain) || data.domain || '', linkedin_url: c.p.linkedin_url || '', location: c.p.location, site_match: c.site, source: 'deepline search_contact 2026-11-26', note: notes.join(' ') });
    }
  }
  rows.push(...old.filter((r) => !done.has(r.rank) && targets.some((t) => t.rank === r.rank)));
  rows.sort((a, b) => a.rank - b.rank);
  fs.writeFileSync(CONTACTS, `${[COLS.join(','), ...rows.map((r) => COLS.map((c) => esc(r[c])).join(','))].join('\n')}\n`);
  return rows;
}

// ---- network ----

let keenableSearches = 0;
let deeplineCalls = 0;

async function website(name) {
  const res = await fetch('https://api.keenable.ai/v1/search', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.KEENABLE_API_KEY }, body: JSON.stringify({ query: `${cleanName(name)} official website`, max_results: 8 }), signal: AbortSignal.timeout(60000) });
  if (!res.ok) return '';
  const json = await res.json();
  keenableSearches++;
  if (json.usage?.paid) throw new Error('Keenable reported a paid call');
  const tokens = brandTokens(name).map(squash);
  const initials = tokens.map((t) => t[0]).join('');
  for (const r of json.results || []) {
    if (SKIP_SITES.test(r.url)) continue;
    const host = new URL(r.url).hostname.replace(/^www\./, '');
    const label = squash(host.split('.').slice(-2, -1)[0]);
    if (tokens.some((t) => t.length >= 3 && !GENERIC.has(t.toUpperCase()) && label.includes(t)) || (initials.length >= 3 && label === initials)) return host.split('.').slice(-2).join('.');
  }
  return '';
}

const findPersons = (o, depth = 0) => {
  if (!o || typeof o !== 'object' || depth > 6) return null;
  if (Array.isArray(o.persons)) return o.persons;
  for (const v of Object.values(o)) { const r = findPersons(v, depth + 1); if (r) return r; }
  return null;
};

async function contactSearch(query, page) {
  const input = path.join(TMP, 'in.json');
  const output = path.join(TMP, 'out.json');
  fs.writeFileSync(input, JSON.stringify({ ...query, title_lists: [{ name: 'roles', titles: TITLES }], location_countries: ['United States'], page_size: PAGE_SIZE, page_number: page, free_only: true }));
  for (let attempt = 1; ; attempt++) {
    fs.rmSync(output, { force: true });
    await wait(PAUSE_MS);
    try {
      // deepline is a .cmd file on Windows, so it needs a shell. Only fixed file paths reach the command line.
      await exec(`deepline run search_contact --input-file "${input}" --json-out "${output}"`, { shell: true, timeout: 180000, maxBuffer: 20e6 });
      deeplineCalls++;
      return findPersons(JSON.parse(fs.readFileSync(output))) || [];
    } catch (e) {
      if (attempt >= 3) throw new Error(`search_contact failed: ${String(e.stderr || e.message).slice(0, 200)}`);
      await wait(15000 * attempt);
    }
  }
}

const allowance = () => Number((execSync('deepline describe search_contact', { encoding: 'utf8' }).match(/([\d,]+) results remaining/)?.[1] || '0').replace(/,/g, ''));

/** Domain first. If that gives no one in the state, search by the plant's business name. */
async function searchCompany(t, left) {
  const domain = await website(t.name);
  const persons = [];
  const seen = new Set();
  const names = [...new Set([cleanName(t.name), cleanName(t.facility)])].filter((n) => n.length >= 3);
  const queries = [...(domain ? [{ domain }] : []), ...names.map((company_name) => ({ company_name }))].slice(0, 2);
  const tried = [];
  for (const query of queries) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await contactSearch(query, page);
      tried.push({ ...query, page, returned: batch.length });
      for (const p of batch) {
        const key = p.linkedin_url || `${p.first_name} ${p.last_name}`;
        if (!seen.has(key)) { seen.add(key); persons.push({ ...p, experiences: undefined, about: undefined, by_name: Boolean(query.company_name) }); }
      }
      // Another page only for a big company with no one in the state, and only while the allowance lasts.
      if (batch.length < PAGE_SIZE || pick(t, persons).length || left < 1000) break;
    }
    if (pick(t, persons).length === 2) break;
  }
  return { rank: t.rank, name: t.name, domain, searched_by: tried, persons };
}

async function run() {
  for (const dir of ['.', '../..']) {
    const f = path.join(dir, '.env.local');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      if (i > 0 && !line.startsWith('#') && !process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!process.env.KEENABLE_API_KEY) throw new Error('KEENABLE_API_KEY is not set');
  execFileSync('git', ['check-ignore', '-q', CONTACTS], { cwd: DIR });
  fs.mkdirSync(DL, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  const todo = targets.filter((t) => !fs.existsSync(path.join(DL, `${t.rank}.json`)));
  const failed = [];
  let left = allowance();
  console.log(`${todo.length} companies to search, free allowance ${left}`);
  try {
    for (let i = 0; i < todo.length; i++) {
      if (i % 20 === 0) left = allowance();
      if (left < PAGE_SIZE * 2) { console.log(`Stopped: free allowance is down to ${left}`); break; }
      const t = todo[i];
      try {
        const data = await searchCompany(t, left);
        fs.writeFileSync(path.join(DL, `${t.rank}.json`), JSON.stringify(data));
        const rows = writeContacts();
        console.log(`${i + 1}/${todo.length} rank ${t.rank}: ${rows.filter((r) => r.rank === t.rank).length} picked`);
      } catch (e) {
        failed.push(`${t.rank}: ${e.message}`);
        console.log(`rank ${t.rank} failed: ${e.message}`);
        if (failed.length > 8) break;
      }
    }
  } finally {
    for (const [provider, tool, count, unit] of [['keenable', 'v1/search', keenableSearches, 'searches'], ['deepline', 'search_contact', deeplineCalls, 'calls']]) {
      if (count) execFileSync('node', ['pipeline/ledger.mjs', 'add', '04f contact search', provider, tool, String(count), `${count} ${unit}`, provider === 'deepline' ? '0' : '', provider === 'keenable' ? '0' : '', '', provider === 'deepline' ? 'free_only input' : 'API response usage fields', 'Free allowance.'], { stdio: 'inherit' });
    }
  }
  const rows = writeContacts();
  console.log(JSON.stringify({ companies: targets.length, searched: targets.filter((t) => fs.existsSync(path.join(DL, `${t.rank}.json`))).length, people: rows.length, companies_with_a_person: new Set(rows.map((r) => r.rank)).size, allowance_left: allowance(), failed }));
}

/**
 * Second pass for companies with no one picked: the next page of a full search, then names not yet tried.
 * At most 2 more calls a company, so the free allowance covers the whole list.
 */
async function gaps() {
  fs.mkdirSync(TMP, { recursive: true });
  const read = (t) => JSON.parse(fs.readFileSync(path.join(DL, `${t.rank}.json`)));
  const todo = targets.filter((t) => { const d = read(t); return !d.gap_pass && !pick(t, d.persons || []).length && !(readCsv(path.relative(process.cwd(), CONTACTS)).some((r) => r.rank === t.rank)); });
  const failed = [];
  let found = 0;
  let left = allowance();
  console.log(`${todo.length} companies with no one picked, free allowance ${left}`);
  try {
    for (let i = 0; i < todo.length; i++) {
      if (i % 20 === 0) left = allowance();
      if (left < PAGE_SIZE * 2) { console.log(`Stopped: free allowance is down to ${left}`); break; }
      const t = todo[i];
      const file = path.join(DL, `${t.rank}.json`);
      const old = read(t);
      const data = { rank: t.rank, name: t.name, domain: old.domain || '', searched_by: old.searched_by || [], persons: old.persons?.[0]?.by_name === undefined ? [] : old.persons };
      const account = accounts.get(t.rank);
      const tried = new Set(data.searched_by.map((q) => q.domain || q.company_name));
      const full = data.searched_by.find((q) => q.returned >= 8);
      const queries = [];
      if (full) queries.push({ query: full.domain ? { domain: full.domain } : { company_name: full.company_name }, page: 2 });
      for (const company_name of new Set([account.account_name, t.parent, t.facility, t.name].map(cleanName))) {
        if (company_name.length >= 3 && !tried.has(company_name)) queries.push({ query: { company_name }, page: 1 });
      }
      if (data.domain && !tried.has(data.domain)) queries.unshift({ query: { domain: data.domain }, page: 1 });
      if (full) queries.push({ query: full.domain ? { domain: full.domain } : { company_name: full.company_name }, page: 3 });
      const seen = new Set(data.persons.map((p) => p.linkedin_url || `${p.first_name} ${p.last_name}`));
      try {
        for (const { query, page } of queries.slice(0, 2)) {
          const batch = await contactSearch(query, page);
          data.searched_by.push({ ...query, page, returned: batch.length });
          for (const p of batch) {
            const key = p.linkedin_url || `${p.first_name} ${p.last_name}`;
            if (!seen.has(key)) { seen.add(key); data.persons.push({ ...p, experiences: undefined, about: undefined, by_name: Boolean(query.company_name) }); }
          }
          if (pick(t, data.persons).length) break;
        }
        data.gap_pass = true;
        fs.writeFileSync(file, JSON.stringify(data));
        writeContacts();
        const n = pick(t, data.persons).length;
        if (n) found++;
        console.log(`${i + 1}/${todo.length} rank ${t.rank}: ${n} picked`);
      } catch (e) {
        failed.push(`${t.rank}: ${e.message}`);
        if (failed.length > 8) break;
      }
    }
  } finally {
    if (deeplineCalls) execFileSync('node', ['pipeline/ledger.mjs', 'add', '04f contact search gaps', 'deepline', 'search_contact', String(deeplineCalls), `${deeplineCalls} calls`, '0', '', '', 'free_only input', 'Free allowance.'], { stdio: 'inherit' });
  }
  const rows = writeContacts();
  console.log(JSON.stringify({ gap_companies: todo.length, newly_found: found, people: rows.length, companies_with_a_person: new Set(rows.map((r) => r.rank)).size, allowance_left: allowance(), failed }));
}

const mode = process.argv[2];
if (mode === 'run') await run();
else if (mode === 'gaps') await gaps();
else if (mode === 'pick') console.log(`${writeContacts().length} people`);
else { console.error('Usage: node pipeline/04f_contact_search.mjs run|gaps|pick'); process.exit(1); }
