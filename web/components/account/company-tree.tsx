import type { Company } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

function PlantItem({ plant, start }: { plant: Company; start: boolean }) {
  return (
    <li className="py-0.5">
      <Badge variant="outline">Plant</Badge> {plant.name}{" "}
      <span className="text-muted-foreground">{plant.city}, {plant.state}, {plant.industry}</span>{" "}
      {start ? <Badge>Start here</Badge> : null}{" "}
      {plant.closedNote ? <Badge variant="destructive" title={plant.closedNote}>Closed</Badge> : null}{" "}
      {plant.integrity ? <Badge variant="destructive">Mechanical integrity</Badge>
        : plant.machine ? <Badge variant="destructive">Machine citation</Badge>
        : plant.osha ? <Badge variant="secondary">OSHA serious</Badge> : null}{" "}
      {plant.epa ? <Badge variant="secondary">{plant.epaSnc ? "EPA serious violator" : "EPA equipment"}</Badge> : null}
    </li>
  );
}

const bySignal = (a: Company, b: Company) =>
  Number(b.integrity) - Number(a.integrity) || Number(b.machine) - Number(a.machine) || Number(b.osha) - Number(a.osha) || a.name.localeCompare(b.name);

export function CompanyTree({ account, tree }: { account: Company; tree: Company[] }) {
  const plants = tree.filter((c) => c.level === "PLANT");
  const startBusiness = plants.find((p) => p.id === account.startPlantId)?.parentId;
  const businesses = tree.filter((c) => c.level === "BUSINESS").sort((a, b) => {
    const count = (id: string) => plants.filter((p) => p.parentId === id && p.machine).length;
    return Number(b.id === startBusiness) - Number(a.id === startBusiness) || count(b.id) - count(a.id) || a.name.localeCompare(b.name);
  });
  const direct = plants.filter((p) => p.parentId === account.id).sort(bySignal);

  const node = (key: string, label: React.ReactNode, list: Company[], open: boolean) => (
    <li key={key} className="py-0.5">
      <details open={open}>
        <summary className="cursor-pointer">
          {label}{" "}
          <span className="text-muted-foreground">{list.length} plants, {list.filter((p) => p.machine).length} with machine citation</span>
        </summary>
        <ul className="border-l pl-5">{[...list].sort(bySignal).map((p) => <PlantItem key={p.id} plant={p} start={p.id === account.startPlantId} />)}</ul>
      </details>
    </li>
  );

  return (
    <div className="rounded-lg border p-4 [overflow-wrap:anywhere]">
      <div><Badge>Parent</Badge> <b>{account.name}</b> <span className="text-muted-foreground">{account.industry}</span></div>
      <ul className="mt-1 border-l pl-5">
        {businesses.map((b) =>
          node(b.id, <><Badge variant="secondary">Business</Badge> <b>{b.name}</b> <span className="text-muted-foreground">{b.industry}</span></>,
            plants.filter((p) => p.parentId === b.id), b.id === startBusiness))}
        {businesses.length && direct.length ? node("direct", <b>Not assigned to a business</b>, direct, false) : null}
        {!businesses.length ? direct.map((p) => <PlantItem key={p.id} plant={p} start={p.id === account.startPlantId} />) : null}
      </ul>
    </div>
  );
}
