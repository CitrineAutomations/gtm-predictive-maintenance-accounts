// Progress bars for contact enrichment. It only reads local files. It makes no network calls and shows no names.
// Usage:
//   node pipeline/progress_contacts.mjs          live view, updates every 2 seconds (Ctrl+C to stop)
//   node pipeline/progress_contacts.mjs --once   print once

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// In a worktree the contact files live in the main folder, two levels up.
const inMain = path.join(root, '../..', 'data/contacts');
const DIR = path.join(fs.existsSync(inMain) ? inMain : path.join(root, 'data/contacts'), 'enrichment');
const WIDTH = 30;

const parse = (file) => {
  if (!fs.existsSync(file)) return [];
  const [head, ...lines] = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const cells = (l) => l.match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  const keys = cells(head);
  return lines.map((l) => Object.fromEntries(cells(l).slice(0, keys.length).map((v, i) => [keys[i], v])));
};
const files = (sub) => (fs.existsSync(path.join(DIR, sub)) ? fs.readdirSync(path.join(DIR, sub)).filter((f) => /^\d+\.json$/.test(f)).length : 0);
const bar = (label, done, total) => {
  const share = total ? Math.min(1, done / total) : 0;
  const filled = Math.round(share * WIDTH);
  return `${label.padEnd(22)}[${'#'.repeat(filled)}${'-'.repeat(WIDTH - filled)}] ${String(done).padStart(3)}/${total} (${(share * 100).toFixed(1)}%)`;
};

function view() {
  const total = parse(path.join(root, 'data/processed/contact_list.csv')).filter((r) => r.list_status === 'include').length;
  const picks = parse(path.join(DIR, 'contacts.csv'));
  const companies = (test) => new Set(picks.filter(test).map((r) => r.rank)).size;
  return [
    'Contact enrichment',
    bar('1. Web people search', files('web'), total).replace('1. Web people search ', '1. Web search (pilot)'),
    bar('2. Deepline search', files('dl'), total),
    bar('3. Person picked', companies(() => true), total),
    bar('4. Valid email', companies((r) => r.email_validation_status === 'valid'), total),
    'Step 4 counts companies with at least one valid email. This is the contactable number.',
  ];
}

if (process.argv.includes('--once')) {
  console.log(view().join('\n'));
} else {
  let last = '';
  let changedAt = Date.now();
  const draw = () => {
    const text = view().join('\n');
    if (text !== last) { last = text; changedAt = Date.now(); }
    // Clear the whole screen each time. This works in every Windows terminal.
    console.clear();
    console.log(text);
    console.log(`
Clock ${new Date().toLocaleTimeString()}. Last change ${Math.round((Date.now() - changedAt) / 1000)} seconds ago. Ctrl+C to stop.`);
  };
  draw();
  setInterval(draw, 2000);
}
