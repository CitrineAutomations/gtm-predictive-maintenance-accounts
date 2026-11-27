// Loads the accounts (accounts_250.csv, or the file in ACCOUNTS_CSV), their businesses and plants, OSHA inspection records and the local contacts.
// Usage: pnpm seed    (needs DATABASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD in web/.env)
// The seed replaces companies and contacts. It keeps logged results when the account still exists.
// Inspection records come from the labordata.bunkum.us mirror (third party, free). They are cached in web/.cache.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../lib/prisma";
import { isMachineRule, titleCase } from "../lib/rules";

const ROOT = process.env.PIPELINE_DIR || path.resolve(process.cwd(), "..");
const processed = (file: string) => path.join(ROOT, "data/processed", file);
const CACHE = path.resolve(process.cwd(), ".cache/inspections.json");
const CONTROL_SHARE = 0.2; // one account in five gets the email without a signal

const INDUSTRY: Record<string, string> = {
  "311": "Food", "324": "Petroleum and coal", "325": "Chemicals", "326": "Plastics and rubber",
  "331": "Primary metals", "332": "Fabricated metal", "333": "Machinery", "336": "Transportation equipment",
};

function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(file, "utf8");
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])));
}

type Violation = {
  activity_nr: number; estab_name: string; site_address: string | null; open_date: string;
  standard: string; viol_type: string; current_penalty: number | null;
};

async function violations(ids: string[]): Promise<Violation[]> {
  if (fs.existsSync(CACHE)) {
    const cached = JSON.parse(fs.readFileSync(CACHE, "utf8")) as { ids: number; rows: Violation[] };
    if (cached.ids === ids.length) return cached.rows;
  }
  const rows: Violation[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const sql = `select i.activity_nr, i.estab_name, i.site_address, i.open_date, v.standard, v.viol_type, v.current_penalty
      from inspection i join violation v on v.activity_nr = i.activity_nr
      where i.activity_nr in (${ids.slice(i, i + 40).join(",")})`;
    const res = await fetch(`https://labordata.bunkum.us/osha_enforcement.json?${new URLSearchParams({ sql, _shape: "array" })}`);
    if (!res.ok) throw new Error(`OSHA mirror failed: HTTP ${res.status}`);
    const batch = (await res.json()) as Violation[];
    if (batch.length >= 1000) throw new Error("OSHA mirror truncated a batch. Lower the batch size.");
    rows.push(...batch);
  }
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify({ ids: ids.length, rows }));
  return rows;
}

type SplitRule = { name?: string; pattern: string; trifd?: string };

const STATE_CODES: Record<string, string> = Object.fromEntries(
  ("Alabama:AL,Alaska:AK,Arizona:AZ,Arkansas:AR,California:CA,Colorado:CO,Connecticut:CT,Delaware:DE,Florida:FL,Georgia:GA," +
    "Hawaii:HI,Idaho:ID,Illinois:IL,Indiana:IN,Iowa:IA,Kansas:KS,Kentucky:KY,Louisiana:LA,Maine:ME,Maryland:MD,Massachusetts:MA," +
    "Michigan:MI,Minnesota:MN,Mississippi:MS,Missouri:MO,Montana:MT,Nebraska:NE,Nevada:NV,New Hampshire:NH,New Jersey:NJ," +
    "New Mexico:NM,New York:NY,North Carolina:NC,North Dakota:ND,Ohio:OH,Oklahoma:OK,Oregon:OR,Pennsylvania:PA,Rhode Island:RI," +
    "South Carolina:SC,South Dakota:SD,Tennessee:TN,Texas:TX,Utah:UT,Vermont:VT,Virginia:VA,Washington:WA,West Virginia:WV," +
    "Wisconsin:WI,Wyoming:WY").split(",").map((pair) => pair.split(":")),
);

/** Says in plain words how close a contact is to a plant with a serious OSHA citation. */
function closeness(location: string, plants: Prisma.CompanyCreateManyInput[]) {
  const [city, state] = location.split(",").map((part) => part.trim());
  const code = STATE_CODES[state ?? ""];
  if (!code) return "Unknown. The profile gives no city and state.";
  const cited = plants.filter((p) => p.osha).sort((a, b) => Number(b.machine) - Number(a.machine));
  const same = cited.find((p) => p.state === code && p.city?.toLowerCase() === city.toLowerCase());
  if (same) return `Yes. Same city as a cited plant (${titleCase(same.city!)}, ${code}).`;
  const inState = cited.find((p) => p.state === code);
  if (inState) return `No. Same state only. The cited plant is in ${titleCase(inState.city!)}, ${code}.`;
  return "No. This account has no cited plant in this state.";
}

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in web/.env");

  // ACCOUNTS_CSV can add start_city, start_state and closed_json (pipeline step 06).
  const accounts = readCsv(process.env.ACCOUNTS_CSV || processed("accounts_250.csv"));
  const facilities = readCsv(processed("tri_shortlist_facilities.csv"));
  const osha = new Map(readCsv(processed("osha_plants.csv")).map((r) => [r.trifd, r]));
  const epaFindings = new Map(readCsv(processed("epa_equipment_plants.csv")).map((r) => [r.trifd, r]));
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "pipeline/owner_splits.json"), "utf8"));

  const legalNames = new Set(accounts.map((a) => a.legal_parent_name));
  const ids = [...new Set(
    facilities.filter((f) => legalNames.has(f.parent_name))
      .flatMap((f) => String(osha.get(f.trifd)?.activity_nrs || "").split(" ").filter(Boolean)),
  )];
  const byInspection = new Map<string, Violation[]>();
  for (const v of await violations(ids)) {
    const key = String(v.activity_nr);
    byInspection.set(key, [...(byInspection.get(key) || []), v]);
  }

  const companies: Prisma.CompanyCreateManyInput[] = [];
  const inspections: Prisma.InspectionCreateManyInput[] = [];
  const rootByName = new Map<string, string>();
  const businessByKey = new Map<string, string>();
  const plantsByRoot = new Map<string, { id: string; naics: string; score: [number, number, number, string] }[]>();

  for (const a of accounts) {
    const id = randomUUID();
    rootByName.set(a.legal_parent_name, id);
    companies.push({
      id, level: "PARENT", name: a.account_name, legalName: a.legal_parent_name, rank: Number(a.rank),
      plantCount: Number(a.plants), stateCount: Number(a.states), seriousPlants: Number(a.serious_plants),
      machinePlants: Number(a.machine_plants), integrityPlants: Number(a.integrity_plants),
      startWith: a.businesses || null, reviewNote: a.review_note || null,
    });
  }

  for (const f of facilities) {
    const rootId = rootByName.get(f.parent_name);
    if (!rootId) continue;
    const split = rules.splits[f.parent_name];
    if (split?.exclude?.some((x: SplitRule) => (x.trifd ? x.trifd === f.trifd : new RegExp(x.pattern).test(f.facility_name)))) continue;
    const biz: SplitRule | undefined = split?.businesses.find((x: SplitRule) => new RegExp(x.pattern).test(f.facility_name));
    let parentId = rootId;
    if (biz?.name) {
      const key = `${rootId}|${biz.name}`;
      if (!businessByKey.has(key)) {
        const id = randomUUID();
        businessByKey.set(key, id);
        companies.push({ id, level: "BUSINESS", name: biz.name, parentId: rootId, rootId });
      }
      parentId = businessByKey.get(key)!;
    }

    const plantId = randomUUID();
    let machine = false;
    let integrity = false;
    let machineItems = 0;
    let integrityItems = 0;
    let latest = "";
    for (const activityNr of String(osha.get(f.trifd)?.activity_nrs || "").split(" ").filter(Boolean)) {
      const rows = byInspection.get(activityNr) || [];
      const serious = rows.filter((v) => ["S", "W", "R"].includes(v.viol_type));
      if (!serious.length) continue;
      const standards = [...new Set(serious.map((v) => v.standard))].sort();
      const m = serious.filter((v) => isMachineRule(v.standard)).length;
      const mi = serious.filter((v) => v.standard.startsWith("19100119 J")).length;
      machine ||= m > 0;
      integrity ||= mi > 0;
      machineItems += m;
      integrityItems += mi;
      if (rows[0].open_date > latest) latest = rows[0].open_date;
      inspections.push({
        activityNr, companyId: plantId, openDate: rows[0].open_date, estabName: rows[0].estab_name,
        address: rows[0].site_address?.trim() || null, standards, seriousItems: serious.length,
        penalty: Math.round(rows.reduce((n, v) => n + (v.current_penalty || 0), 0)),
      });
    }
    // Equipment-related EPA findings. Rain runoff alone does not flag a plant.
    const found = epaFindings.get(f.trifd);
    const kinds = ["water_limit", "water_stormwater", "water_bypass", "leak_tank", "air_priority"];
    const findings = Object.fromEntries(kinds.filter((k) => found?.[k]).map((k) => [k, found![k]]));
    const flagged = Boolean(found?.snc) || kinds.some((k) => k !== "water_stormwater" && found?.[k]);
    companies.push({
      id: plantId, level: "PLANT", name: f.facility_name, parentId, rootId, city: f.city, state: f.state, naics: f.naics,
      industry: INDUSTRY[f.naics.slice(0, 3)] || "Other", frsId: f.frs_id || null,
      epaFindings: Object.keys(findings).length ? findings : undefined, epaSnc: found?.snc || null, epaOpen: Boolean(found?.open_kinds),
      osha: Number(osha.get(f.trifd)?.serious || 0) > 0, machine, integrity, epa: flagged,
    });
    plantsByRoot.set(rootId, [
      ...(plantsByRoot.get(rootId) || []),
      { id: plantId, naics: f.naics, score: [integrityItems, machineItems, latest ? 1 : 0, latest] },
    ]);
  }

  for (const c of companies.filter((x) => x.level === "PARENT")) {
    c.epaPlants = companies.filter((p) => p.rootId === c.id && p.level === "PLANT" && p.epa).length;
  }

  // One industry when 60% or more of the plants share it.
  const industryOf = (list: string[]) => {
    const counts = new Map<string, number>();
    for (const n of list) {
      const name = INDUSTRY[n.slice(0, 3)] || "Other";
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const [top] = [...counts].sort((a, b) => b[1] - a[1]);
    return !top ? "Unknown" : top[1] / list.length >= 0.6 ? top[0] : "Mixed";
  };
  for (const c of companies) {
    if (c.level === "PARENT") {
      const plants = plantsByRoot.get(c.id!) || [];
      c.industry = industryOf(plants.map((p) => p.naics));
      // Start plant: most mechanical integrity items, then machine items, then the newest inspection.
      const [start] = [...plants].sort((a, b) =>
        b.score[0] - a.score[0] || b.score[1] - a.score[1] || b.score[2] - a.score[2] || b.score[3].localeCompare(a.score[3]));
      c.startPlantId = start?.id ?? null;
      // The plant check can name the start city. It wins over the ranking.
      const account = accounts.find((a) => a.legal_parent_name === c.legalName);
      if (account?.start_city) {
        const checked = [...plants]
          .sort((a, b) => b.score[0] - a.score[0] || b.score[1] - a.score[1] || b.score[2] - a.score[2] || b.score[3].localeCompare(a.score[3]))
          .find((p) => companies.some((x) => x.id === p.id && x.city === account.start_city && x.state === account.start_state));
        if (checked) c.startPlantId = checked.id;
        else console.warn(`No plant in the start city for ${c.name}`);
      }
    } else if (c.level === "BUSINESS") {
      c.industry = industryOf(companies.filter((p) => p.parentId === c.id && p.level === "PLANT").map((p) => p.naics!));
    }
  }

  // Email groups: random inside each size group, so both groups have the same size mix.
  // The order comes from a hash of the company name, so a reload gives the same groups.
  const hash = (s: string) => createHash("sha256").update(`gtm-test-1|${s}`).digest("hex");
  const parents = companies.filter((c) => c.level === "PARENT");
  for (const [lo, hi] of [[3, 4], [5, 9], [10, Infinity]]) {
    const bucket = parents.filter((p) => p.plantCount! >= lo && p.plantCount! <= hi)
      .sort((a, b) => hash(a.legalName!).localeCompare(hash(b.legalName!)));
    const control = Math.round(bucket.length * CONTROL_SHARE);
    bucket.forEach((p, i) => { p.emailGroup = i < control ? "CONTROL" : "OSHA"; });
  }

  // Company profiles: public facts with a source for each. Closed plants stay in the tree, marked.
  type Profile = { closedPlants?: { city: string; state: string; note: string }[] };
  const profiles: Record<string, Profile> = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "data/profiles.json"), "utf8"));
  for (const [legalName, profile] of Object.entries(profiles)) {
    const rootId = rootByName.get(legalName);
    if (!rootId) { console.warn(`No account for a profile: ${legalName}`); continue; }
    companies.find((c) => c.id === rootId)!.profile = profile as Prisma.InputJsonValue;
    for (const closed of profile.closedPlants ?? []) {
      for (const plant of companies.filter((c) => c.rootId === rootId && c.city === closed.city && c.state === closed.state)) {
        plant.closedNote = closed.note;
      }
    }
  }

  // Plants that the plant check found closed or sold.
  for (const a of accounts) {
    for (const closed of JSON.parse(a.closed_json || "[]") as { city: string; state: string; note: string }[]) {
      for (const plant of companies.filter((c) => c.rootId === rootByName.get(a.legal_parent_name) && c.city === closed.city && c.state === closed.state)) {
        plant.closedNote ??= closed.note;
      }
    }
  }

  // Keep logged results across a reload.
  const oldActivities = await prisma.activity.findMany({ include: { company: true, contact: true } });
  await prisma.company.deleteMany();
  for (const level of ["PARENT", "BUSINESS", "PLANT"]) {
    const batch = companies.filter((c) => c.level === level);
    for (let i = 0; i < batch.length; i += 500) await prisma.company.createMany({ data: batch.slice(i, i + 500) });
  }
  for (let i = 0; i < inspections.length; i += 500) await prisma.inspection.createMany({ data: inspections.slice(i, i + 500) });

  // Contacts are personal data from a local file that Git ignores.
  const accountFor: Record<string, [string, string?]> = {
    "Polynt Composites": ["POLYNT COMPOSITES USA INC"],
    "Dairy Farmers of America": ["DAIRY FARMERS OF AMERICA INC"],
    "Berkshire Hathaway (Lubrizol)": ["BERKSHIRE HATHAWAY INC", "Lubrizol"],
    Cargill: ["CARGILL INC"],
  };
  const csv = process.env.CONTACTS_CSV;
  let contacts = 0;
  if (csv && fs.existsSync(csv)) {
    const checkedOn = fs.statSync(csv).mtime;
    for (const r of readCsv(csv)) {
      const [legalName, business] = accountFor[r.account] ?? [r.legal_parent_name];
      const rootId = rootByName.get(legalName);
      if (!rootId) { console.warn(`No account for a contact row: ${r.account}`); continue; }
      const companyId = (business && businessByKey.get(`${rootId}|${business}`)) || rootId;
      // A person or mailbox named after the company is a sign of a bad record.
      const stem = String(r.domain || "").split(".")[0].toLowerCase();
      const suspect = stem !== "" && [r.last_name, String(r.email || "").split("@")[0]].some((v) => v.toLowerCase() === stem);
      const closedCity = companies.find((c) => c.rootId === rootId && c.closedNote && (r.location || "").toLowerCase().startsWith(`${c.city?.toLowerCase()},`));
      await prisma.contact.create({
        data: {
          warning: r.warning || (closedCity ? `Confirm the job first. The ${titleCase(closedCity.city!)} plant is closed.` : null),
          companyId, rootId, firstName: r.first_name, lastName: r.last_name, role: r.role, title: r.title || null,
          email: r.email || null, emailStatus: suspect ? "suspect" : r.email_validation_status || null,
          linkedin: r.linkedin_url || null, location: r.location || null,
          plantMatch: [closeness(r.location || "", companies.filter((c) => c.rootId === rootId && c.level === "PLANT")), r.check_note && `Check: ${r.check_note}`].filter(Boolean).join(" "),
          source: "Deepline people search and email lookup", checkedOn,
        },
      });
      contacts++;
    }
  }

  // When a usable contact sits in the city of a plant with a machine citation, start at that plant.
  // Not used when the account file names the start city: a checked plant stays.
  const checkedStart = accounts.some((a) => a.start_city);
  for (const person of checkedStart ? [] : await prisma.contact.findMany({ where: { email: { not: null } }, orderBy: { lastName: "asc" } })) {
    if (person.emailStatus === "suspect" || !person.location) continue;
    const plants = await prisma.company.findMany({ where: { rootId: person.rootId, level: "PLANT", machine: true } });
    const match = plants.find((p) => person.location!.toLowerCase().startsWith(`${p.city?.toLowerCase()},`));
    if (match) await prisma.company.update({ where: { id: person.rootId }, data: { startPlantId: match.id } });
  }

  for (const a of oldActivities) {
    const companyId = rootByName.get(a.company.legalName ?? "");
    if (!companyId) continue;
    const contact = a.contact?.email
      ? await prisma.contact.findFirst({ where: { rootId: companyId, email: a.contact.email } })
      : null;
    await prisma.activity.create({
      data: { companyId, contactId: contact?.id, result: a.result, angle: a.angle, note: a.note, userEmail: a.userEmail, createdAt: a.createdAt },
    });
  }

  // One admin user. The password stays in web/.env.
  if (!(await prisma.user.findUnique({ where: { email } }))) {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId, name: "Admin", email, emailVerified: true,
        accounts: { create: { id: randomUUID(), accountId: userId, providerId: "credential", password: await hashPassword(password) } },
      },
    });
  }

  const count = (level: string) => companies.filter((c) => c.level === level).length;
  console.log(JSON.stringify({
    accounts: count("PARENT"), businesses: count("BUSINESS"), plants: count("PLANT"), contacts,
    inspections: inspections.length,
    control: parents.filter((p) => p.emailGroup === "CONTROL").length,
    accountsWithoutStartPlant: parents.filter((p) => !p.startPlantId).length,
  }));
}

// The local database server can keep the connection pool open, so exit when the load is done.
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
