// Step 06: the demo accounts (companies with at least one valid email) and the two files the CRM loads.
// Usage: node pipeline/06_demo_accounts.mjs
// Writes data/processed/accounts_demo.csv (companies, no personal data) and
// data/contacts/enrichment/crm_contacts.csv (personal data, Git ignores it).

import fs from 'node:fs';
import path from 'node:path';
import { readCsv } from './plants.mjs';

const DIR = fs.existsSync('../../data/contacts') ? '../../data/contacts/enrichment' : 'data/contacts/enrichment';
const write = (file, rows) => {
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  fs.writeFileSync(file, `${[cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')}\n`);
};

const demo = readCsv(path.relative(process.cwd(), path.resolve(DIR, 'demo_contacts.csv')));
const ranks = new Set(demo.map((r) => r.rank));
const list = new Map(readCsv('data/processed/contact_list.csv').map((r) => [r.rank, r]));
const accounts = [...readCsv('data/processed/accounts_250.csv'), ...readCsv('data/processed/accounts_extra.csv')].filter((a) => ranks.has(a.rank));
const closed = [
  ...readCsv('data/processed/start_plant_check.csv').filter((r) => r.result === 'replace'),
  ...readCsv('data/processed/backup_plant_check.csv').filter((r) => r.result === 'closed'),
];
const FLAGS = {
  caution_fatality: 'Caution: a worker died here 12 to 24 months ago.',
  caution_injury: 'Caution: a severe injury here.',
  confirm: 'Confirm the plant status.',
  note_incident: 'Do not mention the plant incident.',
};

write('data/processed/accounts_demo.csv', accounts.map((a) => {
  const c = list.get(a.rank);
  return {
    ...a,
    review_note: [FLAGS[c.plant_flag], c.plant_flag && c.note, a.review_note].filter(Boolean).join(' '),
    start_city: c.plant_city, start_state: c.plant_state,
    closed_json: JSON.stringify(closed.filter((r) => r.account_name === a.account_name).map((r) => ({ city: r.city, state: r.state, note: r.what_happened }))),
  };
}));

// Email domains that a review found wrong, one per line, in a local file that Git ignores.
const blockedFile = path.join(DIR, 'blocked_domains.txt');
const blocked = new Set(fs.existsSync(blockedFile) ? fs.readFileSync(blockedFile, 'utf8').split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean) : []);
const warningFor = (r) => {
  if (blocked.has(r.email.split('@')[1].toLowerCase())) return { warning: 'Do not send. The email domain looks like another company.', status: 'suspect' };
  if (r.review_level.startsWith('1')) return { warning: `Check before use. ${r.checks}` };
  return {};
};
write(path.join(DIR, 'crm_contacts.csv'), demo.map((r) => {
  const w = warningFor(r);
  return {
    legal_parent_name: list.get(r.rank).legal_parent_name, first_name: r.first_name, last_name: r.last_name,
    role: r.role === 'plant' ? 'Plant manager' : 'Maintenance manager', title: r.title, email: r.email,
    email_validation_status: w.status || 'valid', domain: r.email.split('@')[1], linkedin_url: r.linkedin_url, location: r.person_location,
    warning: w.warning || '', check_note: w.warning ? '' : r.checks,
  };
}));
console.log(JSON.stringify({ accounts: accounts.length, contacts: demo.length, with_warning: demo.filter((r) => warningFor(r).warning).length, with_closed_plants: accounts.filter((a) => closed.some((r) => r.account_name === a.account_name)).length }));
