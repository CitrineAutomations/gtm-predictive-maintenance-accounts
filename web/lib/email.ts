// The subject, first line and last line are the same for both groups, so the test compares
// the middle only. The email names a city only when the contact is in the city of the start
// plant. It never names a violation, citation or penalty.
export function firstEmail(group: "OSHA" | "CONTROL", firstName: string, city: string | null) {
  const middle =
    group === "OSHA"
      ? "A pump, motor or press can drift weeks before its next scheduled inspection. We help plant teams see that drift early and plan the repair."
      : "We help plant teams see an equipment failure coming and pick the day to fix it.";
  return [
    "Subject: machines and calendars",
    `Machines do not read the maintenance calendar, ${firstName}.`,
    middle,
    `Which equipment at ${city ?? "your plant"} worries you most between inspections? Worth 20 minutes?`,
  ].join("\n\n");
}

type Person = { role: string; email: string | null; emailStatus: string | null; location: string | null; warning: string | null };

/** Someone in the start plant's city first, then a plant manager, then anyone with a usable email. */
export function firstContact<T extends Person>(people: T[], city: string | null): T | null {
  const usable = (p: T) => Boolean(p.email) && p.emailStatus !== "suspect" && !p.warning;
  return (
    people.find((p) => usable(p) && inCity(p.location, city)) ??
    people.find((p) => p.role === "Plant manager" && usable(p)) ??
    people.find(usable) ??
    people.find((p) => p.emailStatus !== "suspect" && !p.warning) ??
    null
  );
}

export const inCity = (location: string | null, city: string | null) =>
  Boolean(location && city && location.toLowerCase().startsWith(`${city.toLowerCase()},`));
