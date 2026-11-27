"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type AccountRow = {
  id: string; rank: number; name: string; industry: string; startWith: string | null;
  contacts: number; plants: number; machine: number; integrity: number; states: string[];
  group: string; lastResult: string | null;
};

type Filters = Record<"q" | "state" | "citation" | "rank" | "industry" | "contacts" | "plants" | "machine" | "group" | "result", string>;
const EMPTY: Filters = { q: "", state: "", citation: "", rank: "", industry: "", contacts: "", plants: "", machine: "", group: "", result: "" };
type SortKey = "rank" | "name" | "industry" | "contacts" | "plants" | "machine" | "group" | "lastResult";

function matches(r: AccountRow, f: Filters) {
  return (
    r.name.toLowerCase().includes(f.q.toLowerCase()) &&
    (!f.state || r.states.includes(f.state)) &&
    (!f.citation || r.integrity > 0) &&
    (!f.rank || r.rank <= Number(f.rank)) &&
    (!f.industry || r.industry === f.industry) &&
    (!f.contacts || (f.contacts === "yes" ? r.contacts > 0 : r.contacts === 0)) &&
    (!f.plants || (f.plants === "3-4" ? r.plants <= 4 : f.plants === "5-9" ? r.plants >= 5 && r.plants <= 9 : r.plants >= 10)) &&
    (!f.machine || r.machine >= Number(f.machine)) &&
    (!f.group || r.group === f.group) &&
    (!f.result || (r.lastResult ?? "None") === f.result)
  );
}

const field = "h-9 rounded-md border bg-background px-3";

export function AccountsTable({ rows }: { rows: AccountRow[] }) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<{ key: SortKey; down: boolean }>({ key: "rank", down: false });
  const set = (key: keyof Filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));

  const shown = rows.filter((r) => matches(r, filters)).sort((a, b) => {
    const x = a[sort.key] ?? "";
    const y = b[sort.key] ?? "";
    const order = typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y));
    return (sort.down ? -order : order) || a.rank - b.rank;
  });
  const industries = [...new Set(rows.map((r) => r.industry))].sort();
  const states = [...new Set(rows.flatMap((r) => r.states))].sort();
  const active = Object.values(filters).some(Boolean);

  const choice = (key: keyof Filters, label: string, options: [string, string][]) => (
    <select value={filters[key]} onChange={(e) => set(key, e.target.value)} aria-label={label} className={`${field} ${filters[key] ? "border-primary bg-accent" : ""}`}>
      {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select>
  );

  const head = (key: SortKey, label: string) => (
    <TableHead aria-sort={sort.key === key ? (sort.down ? "descending" : "ascending") : "none"}>
      <button type="button" className="flex items-center gap-1 whitespace-nowrap font-medium hover:text-foreground"
        onClick={() => setSort((s) => ({ key, down: s.key === key ? !s.down : false }))}>
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.down ? "↓" : "↑") : "↕"}</span>
      </button>
    </TableHead>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Search companies" aria-label="Search companies" className={field} />
        {choice("state", "State with a plant", [["", "All states"], ...states.map((s): [string, string] => [s, s])])}
        {choice("industry", "Industry", [["", "All industries"], ...industries.map((i): [string, string] => [i, i])])}
        {choice("rank", "Rank", [["", "All ranks"], ["25", "Top 25"], ["50", "Top 50"], ["100", "Top 100"]])}
        {choice("contacts", "Contacts", [["", "With or without contacts"], ["yes", "Has contacts"], ["no", "No contacts"]])}
        {choice("plants", "Number of plants", [["", "Any number of plants"], ["3-4", "3 to 4 plants"], ["5-9", "5 to 9 plants"], ["10+", "10 or more plants"]])}
        {choice("machine", "Plants with machine citations", [["", "Any machine citations"], ["1", "1 or more machine citations"], ["2", "2 or more machine citations"], ["3", "3 or more machine citations"]])}
        {choice("citation", "Citation type", [["", "All citation types"], ["integrity", "Mechanical integrity only"]])}
        {choice("group", "Email group", [["", "Both email groups"], ["OSHA", "OSHA group"], ["Control", "Control group"]])}
        {choice("result", "Last result", [["", "Any last result"], ["None", "No result yet"], ["No reply", "No reply"], ["Reply", "Reply"], ["Meeting booked", "Meeting booked"]])}
        <button type="button" onClick={() => setFilters(EMPTY)} disabled={!active} className="h-9 rounded-md border px-3 font-medium disabled:opacity-40">
          Clear filters
        </button>
        <span className="text-muted-foreground">{shown.length} of {rows.length} companies</span>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {head("rank", "Rank")}
              {head("name", "Company")}
              {head("industry", "Industry")}
              {head("contacts", "Contacts")}
              {head("plants", "Plants")}
              {head("machine", "Machine citations")}
              {head("group", "Email group")}
              {head("lastResult", "Last result")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => router.push(`/accounts/${r.id}`)}>
                <TableCell className="tabular-nums">{r.rank}</TableCell>
                <TableCell>
                  <Link href={`/accounts/${r.id}`} prefetch={false} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{r.name}</Link>
                  {r.startWith ? <div className="text-muted-foreground">Start with {r.startWith}</div> : null}
                </TableCell>
                <TableCell>{r.industry}</TableCell>
                <TableCell>{r.contacts ? <Badge className="whitespace-nowrap">{r.contacts} people</Badge> : <span className="text-muted-foreground">None yet</span>}</TableCell>
                <TableCell className="tabular-nums">{r.plants}</TableCell>
                <TableCell className="tabular-nums">{r.machine}</TableCell>
                <TableCell><Badge variant="outline">{r.group}</Badge></TableCell>
                <TableCell>{r.lastResult ?? <span className="text-muted-foreground">None</span>}</TableCell>
              </TableRow>
            ))}
            {!shown.length ? (
              <TableRow><TableCell colSpan={8}>No company matches these filters. Select Clear filters.</TableCell></TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
