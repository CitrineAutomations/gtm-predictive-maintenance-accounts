// Plain names for the OSHA standards that show up most. Check the rule text before you rely on a name.
const NAMES: [string, string][] = [
  ["19100119 D", "Process safety information (1910.119(d))"],
  ["19100119 E", "Process hazard analysis (1910.119(e))"],
  ["19100119 F", "Operating procedures (1910.119(f))"],
  ["19100119 J", "Mechanical integrity: maintenance, inspections and tests of process equipment (1910.119(j))"],
  ["19100119 L", "Management of change (1910.119(l))"],
  ["19100119", "Process safety management (1910.119)"],
  ["19100147", "Lockout and tagout (1910.147)"],
  ["19100212", "Machine guarding (1910.212)"],
  ["19100219", "Power transmission guarding (1910.219)"],
  ["19100178", "Powered industrial trucks (1910.178)"],
  ["19101200", "Hazard communication (1910.1200)"],
  ["19100134", "Respiratory protection (1910.134)"],
  ["19100022", "Walking and working surfaces (1910.22)"],
  ["19100028", "Fall protection duty (1910.28)"],
  ["19100029", "Fall protection systems (1910.29)"],
  ["19100095", "Noise exposure (1910.95)"],
  ["19100146", "Confined spaces (1910.146)"],
  ["19100303", "Electrical, general (1910.303)"],
  ["19100305", "Electrical wiring methods (1910.305)"],
  ["19100307", "Electrical equipment in hazardous locations (1910.307)"],
  ["19101000", "Air contaminants (1910.1000)"],
  ["19100242", "Hand and portable tools (1910.242)"],
  ["5A0001", "General duty clause"],
];

export function ruleName(standard: string) {
  const hit = NAMES.find(([prefix]) => standard.startsWith(prefix));
  if (hit) return hit[1];
  const m = standard.match(/^(1910|1926)(\d{4})/);
  return m ? `Standard ${m[1]}.${Number(m[2])}` : `Standard ${standard}`;
}

/** Lockout, machine guarding, power transmission guarding and mechanical integrity. */
export const isMachineRule = (standard: string) =>
  ["19100147", "19100212", "19100219", "19100119 J"].some((p) => standard.startsWith(p));

/**
 * OSHA establishment search, filled in with the company, state and year.
 * The parameter names come from a search link that the project owner supplied. We have not
 * confirmed the results with an automated check, because osha.gov refuses those requests.
 */
export function oshaSearchUrl(estabName: string, state: string, openDate: string) {
  const words = estabName.replace(/[^A-Za-z0-9&' -]/g, " ").split(/\s+/).filter((w) => w && w.toUpperCase() !== "THE");
  const generic = ["AMERICAN", "DAIRY", "GENERAL", "NATIONAL", "UNITED"];
  const establishment = generic.includes(words[0]?.toUpperCase()) ? words.slice(0, 2).join(" ") : (words[0] ?? estabName);
  const year = openDate.slice(0, 4);
  const query = new URLSearchParams({
    p_logger: "1", establishment, State: state, officetype: "all", Office: "all", sitezip: "",
    p_case: "all", p_violations_exist: "all",
    startmonth: "01", startday: "01", startyear: year, endmonth: "12", endday: "31", endyear: year,
  });
  return `https://www.osha.gov/ords/imis/establishment.search?${query}`;
}

export const titleCase =(s: string) =>
  s.toLowerCase().split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
