// Credit and cost ledger. Every paid call gets one row in docs/credit_ledger.csv.
// Usage:
//   node pipeline/ledger.mjs add <step> <provider> <tool> <calls> <units> <deepline_credits> <direct_usd> <balance_after> "<evidence>" "<note>"
//   node pipeline/ledger.mjs report      prints totals and checks them against the Deepline balance
//
// Rules:
//   - Run `deepline billing balance` before and after a paid run. Put the later reading in balance_after.
//   - Use the receipt or run ID as the evidence. Use "balance difference" when no receipt shows the cost.
//   - Use a blank value when the cost is unknown. Do not guess.
//   - Exa and Keenable bill the key owner in dollars. Put those costs in direct_usd, not in deepline_credits.

import fs from 'node:fs';

const FILE = 'docs/credit_ledger.csv';
const COLS = ['date_utc', 'step', 'provider', 'tool', 'calls', 'units', 'deepline_credits', 'direct_usd', 'balance_after', 'evidence', 'note'];
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function read() {
  if (!fs.existsSync(FILE)) return [];
  const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).slice(1);
  return lines.map((l) => {
    const v = [...l.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
    return Object.fromEntries(COLS.map((c, i) => [c, v[i] ?? '']));
  });
}
const write = (rows) =>
  fs.writeFileSync(FILE, [COLS.join(','), ...rows.map((r) => COLS.map((c) => esc(r[c])).join(','))].join('\n') + '\n');

const [cmd, ...a] = process.argv.slice(2);
if (cmd === 'add') {
  if (a.length < 10) { console.error('Need 10 arguments. See the header of this file.'); process.exit(1); }
  const rows = read();
  rows.push(Object.fromEntries(COLS.map((c, i) => [c, i === 0 ? new Date().toISOString().slice(0, 16) + 'Z' : a[i - 1]])));
  write(rows);
  console.log(`Added row ${rows.length}.`);
} else if (cmd === 'report') {
  const rows = read();
  const n = (v) => (v === '' || v == null ? 0 : Number(v));
  const spend = rows.filter((r) => r.step !== 'opening');
  const credits = spend.reduce((s, r) => s + n(r.deepline_credits), 0);
  const usd = spend.reduce((s, r) => s + n(r.direct_usd), 0);
  const group = (key) => {
    const m = new Map();
    for (const r of spend) {
      const g = m.get(r[key]) || { calls: 0, credits: 0, usd: 0 };
      g.calls += n(r.calls); g.credits += n(r.deepline_credits); g.usd += n(r.direct_usd);
      m.set(r[key], g);
    }
    return [...m.entries()].map(([k, g]) => `  ${k.padEnd(28)} calls ${String(g.calls).padStart(4)}  credits ${g.credits.toFixed(2).padStart(7)}  usd ${g.usd.toFixed(3)}`).join('\n');
  };
  console.log(`Rows: ${rows.length}\nDeepline credits spent: ${credits.toFixed(2)}\nDirect spend (USD): ${usd.toFixed(3)}\n\nBy step:\n${group('step')}\n\nBy provider:\n${group('provider')}`);
  const opening = rows.find((r) => r.step === 'opening');
  const last = [...rows].reverse().find((r) => r.balance_after !== '');
  if (opening && last) {
    const diff = n(opening.balance_after) - n(last.balance_after);
    const ok = Math.abs(diff - credits) < 0.005;
    console.log(`\nCheck: opening ${opening.balance_after} - latest balance ${last.balance_after} = ${diff.toFixed(2)}; ledger sum ${credits.toFixed(2)}; ${ok ? 'MATCH' : 'MISMATCH, find the missing row'}`);
  }
  const unknown = spend.filter((r) => r.deepline_credits === '' && r.direct_usd === '');
  if (unknown.length) console.log(`\nRows with unknown cost: ${unknown.length} (${unknown.map((r) => r.provider).join(', ')})`);
} else {
  console.error('Usage: node pipeline/ledger.mjs add ... | report');
  process.exit(1);
}
