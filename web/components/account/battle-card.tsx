import type { Company, Contact, Inspection } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { firstContact, firstEmail, inCity } from "@/lib/email";
import { GROUP_LABEL } from "@/lib/labels";
import { isMachineRule, oshaSearchUrl, ruleName, titleCase } from "@/lib/rules";
import { CopyButton } from "./copy-button";
import { EpaRecord } from "./epa-record";
import { ProfileSections, type Profile } from "./profile-sections";

const linkButton = "inline-flex h-9 items-center rounded-md border px-3 font-medium";

export function BattleCard({ group, plant, inspections, contacts, profile, epaPlants }: {
  group: "OSHA" | "CONTROL"; plant: Company | null; inspections: Inspection[]; contacts: Contact[]; profile: Profile | null; epaPlants: Company[];
}) {
  if (!plant) return <p className="text-muted-foreground">We have no plant record for this account.</p>;

  const city = titleCase(plant.city ?? "");
  const person = firstContact(contacts, plant.city);
  const here = inCity(person?.location ?? null, plant.city);
  const mail = firstEmail(group, person?.firstName ?? "[first name]", here ? city : null);

  const warnings = [
    !plant.machine ? "The record at this plant is not about machines. Do not use the record as your reason." : null,
    person && !here ? `This person is not listed in ${city}. Do not say the person works there. Ask who runs maintenance in ${city}.` : null,
    person && !person.email ? "We have no email for this person. Use LinkedIn or a phone call." : null,
    person?.email && person.emailStatus !== "valid" ? "This email is not confirmed." : null,
    group === "CONTROL" ? "Control group: send the email as written. Do not mention the record." : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card><CardContent className="pt-4">
          <div className="text-muted-foreground">Start plant</div>
          <div className="text-base font-semibold">{city}, {plant.state}</div>
          <div className="text-muted-foreground">{plant.name}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-muted-foreground">Contact first</div>
          <div className="text-base font-semibold">{person ? `${person.firstName} ${person.lastName}` : "No contact yet"}</div>
          {person ? (
            <>
              <div className="text-muted-foreground">{person.role}, {person.location}</div>
              <div className="select-all break-all">{person.email ?? "No email"}</div>
            </>
          ) : <div className="text-muted-foreground">Find the plant manager in {city}.</div>}
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="text-muted-foreground">Ask this</div>
          <div className="text-base font-semibold">Which equipment worries you most between inspections?</div>
        </CardContent></Card>
      </div>

      {warnings.length ? (
        <div className="flex flex-col gap-1 rounded-lg bg-warn p-4 text-warn-foreground">
          {warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      ) : null}

      <ProfileSections profile={profile} />

      <Card>
        <CardHeader><CardTitle className="text-base">The record</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-4">
          {inspections.length ? inspections.map((i) => {
            const machine = i.standards.filter(isMachineRule);
            const other = i.standards.filter((s) => !isMachineRule(s));
            return (
              <div key={i.id} className="flex flex-col gap-2">
                <p>
                  <b>Inspection {i.activityNr}</b>, opened {i.openDate}. Serious, repeat or willful items: {i.seriousItems}.
                  Listed penalties on the inspection: ${i.penalty.toLocaleString("en-US")}.
                  <span className="block text-muted-foreground">{i.estabName}{i.address ? `, ${i.address}` : ""}</span>
                </p>
                <ul className="list-disc pl-5">
                  {[...new Set(machine.map(ruleName))].map((n) => <li key={n}><b>{n}</b></li>)}
                  {[...new Set(other.map(ruleName))].map((n) => <li key={n}>{n}</li>)}
                </ul>
                <p className="text-muted-foreground">In the results, open the inspection dated {i.openDate}.</p>
                <a className={`${linkButton} self-start`} target="_blank" rel="noreferrer" href={oshaSearchUrl(i.estabName, plant.state ?? "", i.openDate)}>
                  Search OSHA for this inspection
                </a>
              </div>
            );
          }) : <p className="text-muted-foreground">We found no OSHA record with serious items for this plant.</p>}
          <p className="text-muted-foreground">
            These facts come from a third-party copy of OSHA data, not from osha.gov. A company can contest or settle a
            citation. Check the official record before you call.
          </p>
        </CardContent>
      </Card>

      <EpaRecord plant={plant} others={epaPlants.filter((p) => p.id !== plant.id)} />

      <Card>
        <CardHeader><CardTitle className="text-base">Email ({GROUP_LABEL[group]} group)</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-sans">{mail}</pre>
          <CopyButton text={mail} />
        </CardContent>
      </Card>

      <div className="rounded-lg border border-destructive p-4 text-destructive">
        <b>Do not</b>
        <p>Do not open with a citation or a penalty. Do not claim the product fixes safety or compliance. Do not promise savings without customer proof.</p>
      </div>
    </div>
  );
}
