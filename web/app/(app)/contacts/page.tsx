import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function ContactsPage() {
  await requireUser();
  const contacts = await prisma.contact.findMany({ orderBy: { role: "desc" } });
  const accounts = await prisma.company.findMany({
    where: { id: { in: contacts.map((c) => c.rootId) } },
    orderBy: { rank: "asc" },
  });
  const rows = accounts.flatMap((account) =>
    contacts.filter((c) => c.rootId === account.id).map((c) => ({ ...c, account })));

  return (
    <>
      <h1 className="text-xl font-semibold">
        Contacts <span className="text-sm font-normal text-muted-foreground">{rows.length}</span>
      </h1>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Company</TableHead>
              <TableHead>Email</TableHead><TableHead>Location</TableHead><TableHead>Works near a cited plant?</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  {c.firstName} {c.lastName}
                  {c.warning ? <div className="font-normal text-destructive">{c.warning}</div> : null}
                </TableCell>
                <TableCell>{c.role}</TableCell>
                <TableCell><Link href={`/accounts/${c.account.id}`} className="underline">{c.account.name}</Link></TableCell>
                <TableCell>
                  {c.email ?? "Not found"}
                  {c.emailStatus === "suspect" ? <div className="text-destructive">Likely a bad record. Do not send.</div>
                    : c.email && c.emailStatus !== "valid" ? <div className="text-destructive">Not confirmed</div> : null}
                </TableCell>
                <TableCell>{c.location}</TableCell>
                <TableCell>{c.plantMatch}</TableCell>
              </TableRow>
            ))}
            {!rows.length ? <TableRow><TableCell colSpan={6}>No contacts yet. Load a contact file with the seed step.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
