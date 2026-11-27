import Link from "next/link";
import { notFound } from "next/navigation";
import { BattleCard } from "@/components/account/battle-card";
import { CompanyTree } from "@/components/account/company-tree";
import { CopyButton } from "@/components/account/copy-button";
import type { Profile } from "@/components/account/profile-sections";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { firstEmail, inCity } from "@/lib/email";
import { CALL_ROLES, GROUP_LABEL, RESULT_LABEL } from "@/lib/labels";
import { prisma } from "@/lib/prisma";
import { titleCase } from "@/lib/rules";
import { logResult } from "./actions";

const TABS = [
  ["card", "Battle card"], ["contacts", "Contacts"], ["email", "Email"],
  ["tree", "Company tree"], ["why", "Why now"], ["activity", "Activity"],
] as const;
const field = "h-9 rounded-md border bg-background px-2";
const button = "inline-flex h-9 items-center rounded-md border px-3 font-medium";

export default async function AccountPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const { tab: wanted } = await searchParams;
  const tab = TABS.find(([key]) => key === wanted)?.[0] ?? "card";
  const account = await prisma.company.findUnique({ where: { id } });
  if (!account || account.rank === null) notFound();
  const group = account.emailGroup ?? "OSHA";

  const [contacts, startPlant, near] = await Promise.all([
    prisma.contact.findMany({ where: { rootId: id }, include: { company: true } }),
    account.startPlantId
      ? prisma.company.findUnique({ where: { id: account.startPlantId }, include: { inspections: { orderBy: { openDate: "desc" } } } })
      : null,
    prisma.company.findMany({ where: { rank: { in: [account.rank - 1, account.rank + 1] } }, select: { id: true, rank: true } }),
  ]);
  const prev = near.find((n) => n.rank === account.rank! - 1);
  const next = near.find((n) => n.rank === account.rank! + 1);
  const href = (companyId: string, key: string) => `/accounts/${companyId}${key === "card" ? "" : `?tab=${key}`}`;

  return (
    <>
      <p className="text-muted-foreground"><Link href="/" className="hover:underline">Accounts</Link> / <b>{account.name}</b></p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{account.name}</h1>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge>Rank {account.rank}</Badge>
            <Badge variant="outline">{account.industry}</Badge>
            <Badge variant="outline">{account.plantCount} plants in {account.stateCount} states</Badge>
            <Badge variant="outline">Email group: {GROUP_LABEL[group]}</Badge>
            <Badge variant="outline">Customer: unknown</Badge>
          </div>
          {account.reviewNote ? <p className="mt-2 text-muted-foreground">Check first: {account.reviewNote}</p> : null}
        </div>
        <div className="flex gap-2">
          {prev ? <Link className={button} href={href(prev.id, tab)}>Previous</Link> : null}
          {next ? <Link className={button} href={href(next.id, tab)}>Next</Link> : null}
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b">
        {TABS.map(([key, label]) => (
          <Link key={key} href={href(id, key)} aria-current={key === tab ? "page" : undefined}
            className="whitespace-nowrap border-b-2 border-transparent px-3 py-2 font-medium text-muted-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground">
            {label}
          </Link>
        ))}
      </nav>

      {tab === "card" ? (
        <BattleCard group={group} plant={startPlant} inspections={startPlant?.inspections ?? []} contacts={contacts}
          profile={account.profile as Profile | null}
          epaPlants={await prisma.company.findMany({ where: { rootId: id, level: "PLANT", epa: true }, orderBy: [{ epaOpen: "desc" }, { state: "asc" }, { city: "asc" }] })} />
      ) : null}

      {tab === "contacts" ? (
        <>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Role</TableHead><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Location</TableHead><TableHead>Works near a cited plant?</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {CALL_ROLES.flatMap((role) => {
                  const people = contacts.filter((c) => c.role === role);
                  if (!people.length) {
                    return [<TableRow key={role}><TableCell className="font-medium">{role}</TableCell><TableCell colSpan={4} className="text-muted-foreground">No contact yet</TableCell></TableRow>];
                  }
                  return people.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{role}</TableCell>
                      <TableCell>
                        {p.firstName} {p.lastName}
                        {p.company.level === "BUSINESS" ? <div className="text-muted-foreground">{p.company.name}</div> : null}
                        {p.warning ? <div className="text-destructive">{p.warning}</div> : null}
                        {p.linkedin ? <a href={p.linkedin} target="_blank" rel="noreferrer" className="block text-muted-foreground underline">LinkedIn profile</a> : null}
                      </TableCell>
                      <TableCell>
                        {p.email ? <span className="select-all">{p.email}</span> : "Not found"}
                        {p.emailStatus === "suspect" ? <div className="text-destructive">Likely a bad record. Do not send.</div>
                          : p.email && p.emailStatus !== "valid" ? <div className="text-destructive">Not confirmed</div> : null}
                      </TableCell>
                      <TableCell>{p.location}</TableCell>
                      <TableCell>{p.plantMatch}</TableCell>
                    </TableRow>
                  ));
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground">A cited plant has a serious, repeat or willful OSHA citation since 2023-11-01. Locations come from public profiles and may not be the plant where the person works.</p>
        </>
      ) : null}

      {tab === "email" ? (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground">This account is in the {GROUP_LABEL[group]} group. You see only that email.</p>
          {(contacts.length ? contacts.filter((c) => c.email && c.emailStatus !== "suspect" && !c.warning) : [null]).map((person) => {
            const here = inCity(person?.location ?? null, startPlant?.city ?? null);
            const mail = firstEmail(group, person?.firstName ?? "[first name]", here ? titleCase(startPlant!.city!) : null);
            return (
              <Card key={person?.id ?? "template"}><CardContent className="flex flex-col gap-3 pt-4">
                <b>{person ? `${person.firstName} ${person.lastName}, ${person.role}` : "Template"}</b>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-sans">{mail}</pre>
                <CopyButton text={mail} />
              </CardContent></Card>
            );
          })}
          {contacts.length && !contacts.some((c) => c.email && c.emailStatus !== "suspect" && !c.warning) ? (
            <p>No contact on this account has a usable email.</p>
          ) : null}
        </div>
      ) : null}

      {tab === "tree" ? <CompanyTree account={account} tree={await prisma.company.findMany({ where: { rootId: id } })} /> : null}

      {tab === "why" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [account.machinePlants, "Plants with a machine-related citation"],
              [account.integrityPlants, "Plants with a mechanical integrity citation"],
              [account.seriousPlants, "Plants with a serious, repeat or willful OSHA citation"],
              [account.epaPlants, "Plants with an equipment-related EPA violation or serious-violator mark"],
            ].map(([value, label]) => (
              <Card key={label as string}><CardContent className="pt-4"><div className="text-2xl font-semibold tabular-nums">{value}</div><div className="text-muted-foreground">{label}</div></CardContent></Card>
            ))}
          </div>
          <p className="text-muted-foreground">
            OSHA records since 2023-11-01, from a third-party copy. A citation does not prove that equipment failed. Many EPA items are paperwork.
          </p>
        </>
      ) : null}

      {tab === "activity" ? <ActivityTab accountId={id} contacts={contacts} /> : null}
    </>
  );
}

async function ActivityTab({ accountId, contacts }: { accountId: string; contacts: { id: string; firstName: string; lastName: string }[] }) {
  const activities = await prisma.activity.findMany({ where: { companyId: accountId }, include: { contact: true }, orderBy: { createdAt: "desc" } });
  return (
    <Card><CardContent className="flex flex-col gap-3 pt-4">
      <b>Log a result</b>
      <form action={logResult} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="companyId" value={accountId} />
        <select name="contactId" aria-label="Contact" className={field}>
          <option value="">No named contact</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
        </select>
        <select name="result" aria-label="Result" className={field}>
          {Object.entries(RESULT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <input name="note" aria-label="Note" placeholder="Note" maxLength={500} className={`${field} min-w-40 flex-1`} />
        <button className="h-9 rounded-md bg-primary px-4 font-medium text-primary-foreground">Save result</button>
      </form>
      {activities.length ? (
        <ul className="flex flex-col gap-1">
          {activities.map((a) => (
            <li key={a.id}>
              {a.createdAt.toISOString().slice(0, 10)}, <b>{RESULT_LABEL[a.result]}</b>, {GROUP_LABEL[a.angle]}
              {a.contact ? `, ${a.contact.firstName} ${a.contact.lastName}` : ""}
              {a.note ? `, ${a.note}` : ""}
            </li>
          ))}
        </ul>
      ) : <p className="text-muted-foreground">No results yet.</p>}
    </CardContent></Card>
  );
}
