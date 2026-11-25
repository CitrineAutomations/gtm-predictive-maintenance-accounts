import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

const QUESTIONS = [
  "Which equipment stops the line most often?",
  "What does one hour of unplanned downtime cost?",
  "How do you find a failing pump or motor today?",
  "Do you collect vibration, temperature or pressure data?",
  "Who decides on a new tool: the plant, the division or head office?",
  "If one plant gets results, which plant is next?",
];
const OBJECTIONS = [
  ["We already do preventive maintenance.", "Ask which failures still happen between scheduled checks."],
  ["IT will not allow it.", "Offer to include the IT lead early. Ask what rules a new data tool must meet."],
  ["We have no budget.", "Ask what the last unplanned stop cost. Offer a one-plant start."],
  ["Head office decides.", "Ask who at head office, and whether a one-plant trial needs that approval."],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function PlaybookPage() {
  await requireUser();
  return (
    <>
      <h1 className="text-xl font-semibold">Playbook</h1>
      <Section title="Who to contact, in order">
        <p><b>New account:</b> plant manager, then maintenance manager. IT and procurement after the plant team shows interest.</p>
        <p><b>Existing customer:</b> tell the account owner first. Ask your champion at the live plant for results and an introduction.</p>
      </Section>
      <Section title="Questions to ask">
        <ol className="list-decimal pl-5">{QUESTIONS.map((q) => <li key={q}>{q}</li>)}</ol>
      </Section>
      <Section title="Objections">
        <dl className="flex flex-col gap-2">
          {OBJECTIONS.map(([objection, answer]) => <div key={objection}><dt className="font-medium">{objection}</dt><dd>{answer}</dd></div>)}
        </dl>
      </Section>
      <Section title="Do not">
        <p>Do not open with a violation or a penalty. Do not claim the product fixes safety or compliance. Do not promise savings without customer proof.</p>
      </Section>
    </>
  );
}
