// Progress bar for step 04c. It only counts output files. It makes no network calls.
// Usage:
//   node pipeline/progress.mjs [alreadyDone]          live bar, ends when all accounts are done
//   node pipeline/progress.mjs [alreadyDone] --once   print the bar once
// alreadyDone leaves earlier accounts out of the count, for example 5 after a 5-account trial.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'raw', 'plant_check');
const skip = Number(process.argv.find((a, i) => i > 1 && /^\d+$/.test(a)) || 0);
const once = process.argv.includes('--once');
const total = 250 - skip;
const WIDTH = 40;

const files = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^\d{3}\.json$/.test(f)) : []);
const started = Date.now();
const atStart = files().length;

function draw() {
  const all = files();
  const done = Math.max(0, all.length - skip);
  const share = Math.min(1, done / total);
  const filled = Math.round(share * WIDTH);
  const rate = (all.length - atStart) / ((Date.now() - started) / 1000);
  const left = rate > 0 ? `, about ${Math.ceil((total - done) / rate / 60)} min left` : '';
  const line = `[${'#'.repeat(filled)}${'-'.repeat(WIDTH - filled)}] ${done}/${total} accounts (${Math.floor(share * 100)}%)${done < total ? left : ', done'}`;
  process.stdout.write(once ? `${line}\n` : `\r${line}   `);
  return done >= total;
}

if (!draw() && !once) {
  const timer = setInterval(() => { if (draw()) { clearInterval(timer); process.stdout.write('\n'); } }, 2000);
}
