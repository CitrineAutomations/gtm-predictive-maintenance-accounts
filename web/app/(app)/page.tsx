import { AccountsTable } from "@/components/account/accounts-table";
import { requireUser } from "@/lib/auth";
import { GROUP_LABEL, RESULT_LABEL } from "@/lib/labels";
import { prisma } from "@/lib/prisma";

export default async function AccountsPage() {
  await requireUser();
  const [accounts, people] = await Promise.all([
    prisma.company.findMany({
      where: { rank: { not: null } },
      orderBy: { rank: "asc" },
      include: { activities: { orderBy: { createdAt: "desc" }, take: 1 } },
    }),
    prisma.contact.groupBy({ by: ["rootId"], _count: { _all: true } }),
  ]);
  const byRoot = new Map(people.map((p) => [p.rootId, p._count._all]));
  // The states where each account has a plant, for the state filter.
  const plantStates = await prisma.company.findMany({
    where: { level: "PLANT" }, select: { rootId: true, state: true }, distinct: ["rootId", "state"],
  });
  const states = new Map<string, string[]>();
  for (const p of plantStates) {
    if (p.rootId && p.state) states.set(p.rootId, [...(states.get(p.rootId) ?? []), p.state]);
  }
  const rows = accounts.map((a) => ({
    id: a.id, rank: a.rank!, name: a.name, industry: a.industry ?? "Unknown",
    startWith: a.startWith?.split("; ")[0] ?? null, contacts: byRoot.get(a.id) ?? 0, plants: a.plantCount,
    integrity: a.integrityPlants, states: states.get(a.id) ?? [],
    machine: a.machinePlants, group: GROUP_LABEL[a.emailGroup ?? "OSHA"],
    lastResult: a.activities[0] ? RESULT_LABEL[a.activities[0].result] : null,
  }));

  return (
    <>
      <h1 className="text-xl font-semibold">Accounts</h1>
      <AccountsTable rows={rows} />
    </>
  );
}
