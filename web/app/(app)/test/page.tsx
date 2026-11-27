import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { GROUP_LABEL } from "@/lib/labels";
import { prisma } from "@/lib/prisma";

export default async function TestPage() {
  await requireUser();
  const [accounts, activities] = await Promise.all([
    prisma.company.findMany({ where: { rank: { not: null } }, select: { id: true, emailGroup: true } }),
    prisma.activity.findMany({ select: { companyId: true, result: true, angle: true } }),
  ]);
  // Count each account once: an account replied when any of its results is a reply or a meeting.
  const stats = (["OSHA", "CONTROL"] as const).map((group) => {
    const rows = activities.filter((a) => a.angle === group);
    const ids = (list: typeof rows) => new Set(list.map((a) => a.companyId)).size;
    const contacted = ids(rows);
    const replied = ids(rows.filter((a) => a.result !== "NO_REPLY"));
    return {
      group, accounts: accounts.filter((a) => a.emailGroup === group).length, contacted, replied,
      meetings: ids(rows.filter((a) => a.result === "MEETING")),
      rate: contacted ? `${Math.round((100 * replied) / contacted)}%` : "No data yet",
    };
  });

  return (
    <>
      <h1 className="text-xl font-semibold">60-day test</h1>
      <p className="max-w-prose text-muted-foreground">
        Question: does the OSHA email get more replies than the email with no signal? Each account has one group. The groups are
        random inside three size groups (3 to 4, 5 to 9, and 10 or more plants).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {stats.map((s) => (
          <Card key={s.group}><CardContent className="pt-4"><div className="text-2xl font-semibold tabular-nums">{s.accounts}</div><div className="text-muted-foreground">{GROUP_LABEL[s.group]} group accounts</div></CardContent></Card>
        ))}
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Group</TableHead><TableHead>Accounts contacted</TableHead><TableHead>Replied</TableHead><TableHead>Meetings</TableHead><TableHead>Reply rate</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((s) => (
              <TableRow key={s.group}>
                <TableCell className="font-medium">{GROUP_LABEL[s.group]}</TableCell>
                <TableCell>{s.contacted}</TableCell>
                <TableCell>{s.replied}</TableCell>
                <TableCell>{s.meetings}</TableCell>
                <TableCell>{s.rate}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="max-w-prose text-muted-foreground">
        Groups of this size show a direction only. A small gap between the rates is noise. The 20% control share is a proposal.
      </p>
    </>
  );
}
