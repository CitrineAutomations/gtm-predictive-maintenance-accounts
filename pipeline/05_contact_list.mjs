// Step 05: the list of companies to contact. accounts_250.csv stays as the ranking made it.
// This file adds the decisions from the plant check on top: who is dropped, who is held and who replaces them.
// Usage: node pipeline/05_contact_list.mjs   (run 03b, "03b 25" and the plant checks first)
//
// list_status: include = can move to the contact search. hold = recent death, no email now. dropped = no usable plant.
// "include" does not mean contactable. That needs a named person with a valid email.
// plant_flag repeats the plant check result. A person decides on cautions, owner changes and confirms.

import fs from 'node:fs';
import { readCsv, candidatePlants } from './plants.mjs';

// Decided 2026-11-26.
const DROPPED = {
  60: 'Both plants on the list closed.',
  181: 'Start plant sold. No other plant has a serious citation.',
  244: 'Start plant closing. No other plant has a serious citation.',
  // Owner change or pending sale. The owner decided to replace these.
  11: 'Owner change or pending sale.',
  13: 'Owner change or pending sale.',
  94: 'Owner change or pending sale.',
  123: 'Owner change or pending sale.',
  218: 'Owner change or pending sale.',
  220: 'Owner change or pending sale.',
  232: 'Owner change or pending sale.',
};
const ADDED = [251, 252, 253, 254, 255, 259, 260, 263, 265, 268, 269, 272, 273, 274, 275];
// Start plant replaced by another plant of the same company.
// The flag for the new plant comes from backup_plant_check.csv.
const SWAPPED = { 90: { order: 2 } };
const BACKUP_FLAG = { fatality: 'caution_fatality', injury: 'caution_injury' };

const originals = readCsv('data/processed/accounts_250.csv');
const extras = readCsv('data/processed/accounts_extra.csv').filter((a) => ADDED.includes(Number(a.rank)));
if (extras.length !== ADDED.length) throw new Error(`Found ${extras.length} of ${ADDED.length} added accounts`);

const checks = new Map([...readCsv('data/processed/start_plant_check.csv'), ...readCsv('data/processed/extra_plant_check.csv')]
  .map((r) => [r.account_name, r]));

const rows = [...originals, ...extras].map((a) => {
  const rank = Number(a.rank);
  const swap = SWAPPED[rank];
  const plant = candidatePlants(a)[swap ? swap.order - 1 : 0];
  const check = checks.get(a.account_name);
  const backup = swap && readCsv('data/processed/backup_plant_check.csv').find((r) => r.account_name === a.account_name && r.city === plant.city);
  const flag = swap ? BACKUP_FLAG[backup?.result] || '' : check?.result || '';
  const status = DROPPED[rank] ? 'dropped' : flag === 'hold_fatality' ? 'hold' : 'include';
  return {
    rank, account_name: a.account_name, legal_parent_name: a.legal_parent_name,
    list_status: status, added: ADDED.includes(rank) ? 'yes' : '',
    plant_city: status === 'dropped' ? '' : plant.city, plant_state: status === 'dropped' ? '' : plant.state,
    plant_flag: ['none_found', 'replace'].includes(flag) ? '' : flag,
    note: DROPPED[rank] || (swap && `Start plant business sold. ${backup?.what_happened || ''}`.trim()) || (check && !['none_found', 'no_sentence'].includes(check.result) ? check.what_happened : ''),
    review_note: a.review_note || '',
  };
});

const cols = Object.keys(rows[0]);
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
fs.writeFileSync('data/processed/contact_list.csv', `${[cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')}\n`);

const tally = (key, list) => list.reduce((c, r) => { c[r[key] || '(none)'] = (c[r[key] || '(none)'] || 0) + 1; return c; }, {});
console.log(JSON.stringify({ rows: rows.length, status: tally('list_status', rows), flags_in_include: tally('plant_flag', rows.filter((r) => r.list_status === 'include')), include_with_review_note: rows.filter((r) => r.list_status === 'include' && r.review_note).length, added: rows.filter((r) => r.added).map((r) => `${r.rank} ${r.account_name} @ ${r.plant_city} ${r.plant_state}`) }, null, 2));
