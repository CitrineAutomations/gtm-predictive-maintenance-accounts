// Step 02b: EPA ECHO compliance signal for the shortlist plants.
// Usage: node pipeline/02b_echo.mjs
//
// Reads data/processed/tri_shortlist_facilities.csv (from step 01).
// Downloads the ECHO exporter file to data/raw/echo_exporter.zip when missing (about 450 MB).
// Streams the 2 GB ECHO_EXPORTER.csv. It keeps only rows whose REGISTRY_ID equals a plant FRS ID.
// Writes data/processed/echo_plants.csv (ignored) and data/processed/echo_parents.csv.
// Needs `unzip` or `tar` on the PATH. The step costs no Deepline credits.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const RAW = 'data/raw';
const OUT = 'data/processed';
const ZIP = path.join(RAW, 'echo_exporter.zip');
const URL = 'https://echo.epa.gov/files/echodownloads/echo_exporter.zip';
const KEEP = [
  'REGISTRY_ID', 'FAC_ACTIVE_FLAG', 'FAC_INSPECTION_COUNT', 'FAC_FORMAL_ACTION_COUNT',
  'FAC_DATE_LAST_FORMAL_ACTION', 'FAC_TOTAL_PENALTIES', 'FAC_QTRS_WITH_NC',
  'CAA_QTRS_WITH_NC', 'CWA_QTRS_WITH_NC', 'RCRA_QTRS_WITH_NC', 'CWA_13QTRS_EFFLNT_EXCEEDANCES',
];

function parseCsv(text) { // small parser for the plant file
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// Plants from step 01
const plantRows = parseCsv(fs.readFileSync(path.join(OUT, 'tri_shortlist_facilities.csv'), 'utf8'));
const ph = plantRows[0];
const pIdx = (n) => ph.indexOf(n);
const plants = plantRows.slice(1).filter((r) => r.length > 1).map((r) => ({
  trifd: r[pIdx('trifd')], frs_id: r[pIdx('frs_id')], facility_name: r[pIdx('facility_name')],
  state: r[pIdx('state')], parent_name: r[pIdx('parent_name')],
}));
const wanted = new Set(plants.map((p) => p.frs_id).filter(Boolean));

// Download
fs.mkdirSync(RAW, { recursive: true });
if (!fs.existsSync(ZIP)) {
  console.error('Downloading ECHO exporter file...');
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`ECHO download failed: HTTP ${res.status}`);
  const { Readable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(ZIP));
}

// Stream the CSV out of the zip
function openCsvStream() {
  const tryCmd = (cmd, args) => new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    p.once('error', reject);
    p.once('spawn', () => resolve(p));
  });
  return tryCmd('unzip', ['-p', ZIP, 'ECHO_EXPORTER.csv']).catch(() => tryCmd('tar', ['-xOf', ZIP, 'ECHO_EXPORTER.csv']));
}

const proc = await openCsvStream();
proc.stdout.setEncoding('utf8');

const found = new Map(); // registry id -> record
let header = null; let keepIdx = null;
let row = []; let field = ''; let inQ = false; let rowCount = 0;
const handleRow = (r) => {
  rowCount++;
  if (!header) {
    header = r;
    keepIdx = KEEP.map((n) => {
      const i = header.indexOf(n);
      if (i < 0) throw new Error(`ECHO column not found: ${n}`);
      return i;
    });
    return;
  }
  const id = r[keepIdx[0]];
  if (wanted.has(id) && !found.has(id)) found.set(id, Object.fromEntries(KEEP.map((n, k) => [n, r[keepIdx[k]]])));
};

for await (const chunk of proc.stdout) {
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk.charCodeAt(i);
    if (inQ) {
      if (c === 34) { if (chunk.charCodeAt(i + 1) === 34) { field += '"'; i++; } else inQ = false; }
      else field += chunk[i];
    } else if (c === 34) inQ = true;
    else if (c === 44) { row.push(field); field = ''; }
    else if (c === 10) { row.push(field); handleRow(row); row = []; field = ''; }
    else if (c !== 13) field += chunk[i];
  }
}
if (field.length || row.length) { row.push(field); handleRow(row); }

const num = (v) => { const n = Number(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : 0; };
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// Plant-level output (ignored by git)
const plantCols = ['trifd', 'frs_id', 'facility_name', 'state', 'parent_name', 'in_echo', ...KEEP.slice(1)];
const plantOut = plants.map((p) => {
  const e = found.get(p.frs_id);
  return { ...p, in_echo: e ? 1 : 0, ...(e || {}) };
});
fs.writeFileSync(
  path.join(OUT, 'echo_plants.csv'),
  [plantCols.join(','), ...plantOut.map((p) => plantCols.map((c) => esc(p[c])).join(','))].join('\n'),
);

// Parent-level output (committed)
const parents = new Map();
for (const p of plantOut) {
  const a = parents.get(p.parent_name) || {
    parent_name: p.parent_name, plants: 0, plants_in_echo: 0, plants_with_nc: 0, plants_nc_4plus_qtrs: 0,
    plants_with_formal_action: 0, total_penalties_usd: 0, max_qtrs_nc: 0,
  };
  a.plants++;
  if (p.in_echo) {
    a.plants_in_echo++;
    if (num(p.FAC_QTRS_WITH_NC) > 0) a.plants_with_nc++;
    if (num(p.FAC_QTRS_WITH_NC) >= 4) a.plants_nc_4plus_qtrs++;
    if (num(p.FAC_FORMAL_ACTION_COUNT) > 0) a.plants_with_formal_action++;
    a.total_penalties_usd += num(p.FAC_TOTAL_PENALTIES);
    a.max_qtrs_nc = Math.max(a.max_qtrs_nc, num(p.FAC_QTRS_WITH_NC));
  }
  parents.set(p.parent_name, a);
}
const parentCols = ['parent_name', 'plants', 'plants_in_echo', 'plants_with_nc', 'plants_nc_4plus_qtrs', 'plants_with_formal_action', 'total_penalties_usd', 'max_qtrs_nc'];
const list = [...parents.values()].sort((a, b) => b.plants_with_nc - a.plants_with_nc || b.plants - a.plants);
fs.writeFileSync(
  path.join(OUT, 'echo_parents.csv'),
  [parentCols.join(','), ...list.map((a) => parentCols.map((c) => esc(a[c])).join(','))].join('\n'),
);

const summary = {
  echo_rows_read: rowCount - 1,
  shortlist_plants: plants.length,
  plants_with_frs_id: wanted.size,
  plants_found_in_echo: plantOut.filter((p) => p.in_echo).length,
  parents: list.length,
  parents_with_any_nc_plant: list.filter((a) => a.plants_with_nc > 0).length,
  parents_with_2plus_nc_plants: list.filter((a) => a.plants_with_nc >= 2).length,
  parents_with_nc_4plus_qtrs_at_1plus_plant: list.filter((a) => a.plants_nc_4plus_qtrs >= 1).length,
  parents_with_nc_4plus_qtrs_at_2plus_plants: list.filter((a) => a.plants_nc_4plus_qtrs >= 2).length,
  parents_with_any_formal_action: list.filter((a) => a.plants_with_formal_action > 0).length,
};
fs.writeFileSync(path.join(OUT, 'echo_summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
