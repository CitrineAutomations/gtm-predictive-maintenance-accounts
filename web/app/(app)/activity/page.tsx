import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { GROUP_LABEL, RESULT_LABEL } from "@/lib/labels";
import { prisma } from "@/lib/prisma";

export default async function ActivityPage() {
  await requireUser();
  const rows = await prisma.activity.findMany({ include: { company: true, contact: true }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <>
      <h1 className="text-xl font-semibold">Activity</h1>
      <p className="text-muted-foreground">The last 100 results that SDRs logged, newest first.</p>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Date</TableHead><TableHead>Company</TableHead><TableHead>Contact</TableHead><TableHead>Group</TableHead><TableHead>Result</TableHead><TableHead>Note</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="tabular-nums">{a.createdAt.toISOString().slice(0, 10)}</TableCell>
                <TableCell><Link href={`/accounts/${a.companyId}?tab=activity`} className="underline">{a.company.name}</Link></TableCell>
                <TableCell>{a.contact ? `${a.contact.firstName} ${a.contact.lastName}` : "No named contact"}</TableCell>
                <TableCell>{GROUP_LABEL[a.angle]}</TableCell>
                <TableCell>{RESULT_LABEL[a.result]}</TableCell>
                <TableCell>{a.note}</TableCell>
              </TableRow>
            ))}
            {!rows.length ? <TableRow><TableCell colSpan={6}>No results yet. Log a result on an account page.</TableCell></TableRow> : null}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
