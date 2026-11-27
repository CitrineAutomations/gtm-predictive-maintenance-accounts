import type { Company } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { titleCase } from "@/lib/rules";

/** Filled by the seed from pipeline step 02g. Each value is a list such as "pH (8x, last 2025-07-31); ...". */
export type EpaFindings = Partial<Record<"water_limit" | "water_stormwater" | "water_bypass" | "leak_tank" | "air_priority", string>>;

const KINDS = [
  ["water_limit", "Water discharge above the permit limit", "The plant released more into water than the permit allows."],
  ["water_bypass", "Bypass, overflow or spill", "Wastewater went around the treatment system or escaped."],
  ["leak_tank", "Leak and tank rules for hazardous waste", "Rules on leaking pumps, valves, vents, tanks and containers."],
  ["air_priority", "Serious air violation", "EPA calls it a High Priority Violation. The cause is not always equipment."],
  ["water_stormwater", "Rain runoff above a limit", "Stormwater permit. This is not a process or equipment failure."],
] as const;

const report = (frsId: string) => `https://echo.epa.gov/detailed-facility-report?fid=${frsId}`;
const findingsOf = (plant: Company) => (plant.epaFindings ?? {}) as EpaFindings;

/** "A (2x, last 2025-01-01); B (1x, ...)" into separate lines. */
const lines = (text: string) => text.split(/(?<=\d{4}-\d{2}-\d{2}\));\s*/);
/** EPA repeats a long preamble on hazardous waste rule names. Drop it. */
const short = (line: string) => line.replace(/^(Interim Status )?Standards for Owners and Operators of HW TSDs:\s*/, "");

/** EPA background for the start plant and the other flagged plants, with a short reading guide. */
export function EpaRecord({ plant, others }: { plant: Company; others: Company[] }) {
  const findings = findingsOf(plant);
  const found = KINDS.filter(([key]) => findings[key]);

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">EPA record (background only)</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {plant.epaSnc ? <Badge variant="destructive">EPA serious violator: {plant.epaSnc}</Badge> : null}
          {plant.epaOpen ? <Badge variant="destructive">Open items</Badge> : null}
          <span className="font-medium">
            {found.length || plant.epaSnc
              ? "Start plant. Do not raise this on a call or in an email."
              : "The start plant has no equipment-related EPA violation since 2023-11-01."}
          </span>
        </div>

        {found.map(([key, name, meaning]) => (
          <div key={key} className="rounded-lg border p-3">
            <b>{name}</b>
            <p className="text-muted-foreground">{meaning}</p>
            <ul className="list-disc pl-5">{lines(findings[key]!).map((line) => <li key={line}>{short(line)}</li>)}</ul>
          </div>
        ))}

        {plant.frsId ? (
          <a className="inline-flex h-9 items-center self-start rounded-md border px-3 font-medium" target="_blank" rel="noreferrer" href={report(plant.frsId)}>
            Open the EPA facility report
          </a>
        ) : null}

        {others.length ? (
          <details>
            <summary className="cursor-pointer font-medium">Other plants of this account with an EPA flag ({others.length})</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {others.map((other) => (
                <li key={other.id}>
                  <b>{titleCase(other.city ?? "")}, {other.state}</b>{" "}
                  <span className="text-muted-foreground">
                    {[
                      ...KINDS.filter(([key]) => findingsOf(other)[key]).map(([, name]) => name),
                      other.epaSnc ? `serious violator (${other.epaSnc})` : null,
                      other.epaOpen ? "open items" : null,
                    ].filter(Boolean).join(", ")}
                  </span>{" "}
                  {other.frsId ? <a className="underline" target="_blank" rel="noreferrer" href={report(other.frsId)}>Report</a> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="rounded-lg bg-muted p-3">
          <b>How to read this</b>
          <ul className="list-disc pl-5">
            <li><b>Water</b> (Clean Water Act): what goes into drains, rivers and sewers.</li>
            <li><b>Waste</b> (Resource Conservation and Recovery Act): how the plant handles hazardous waste.</li>
            <li><b>Air</b> (Clean Air Act): what goes up a stack or leaks into the air.</li>
            <li><b>Serious violator</b>: EPA marks the plant for serious or long-running non-compliance.</li>
            <li><b>Open</b>: the EPA record shows no date of return to compliance. The plant may have fixed it.</li>
          </ul>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <div>
              <b>This can tell you</b>
              <ul className="list-disc pl-5">
                <li>Which topic the plant has trouble with</li>
                <li>Which plant to look at first</li>
                <li>Who may own the topic, often an environmental manager</li>
              </ul>
            </div>
            <div>
              <b>This cannot tell you</b>
              <ul className="list-disc pl-5">
                <li>That a machine failed</li>
                <li>Anything safe to put in an email</li>
              </ul>
            </div>
          </div>
        </div>
        <p className="text-muted-foreground">
          From EPA bulk files read on 2026-11-25. The grouping and the guide are ours, not EPA&apos;s.
        </p>
      </CardContent>
    </Card>
  );
}
