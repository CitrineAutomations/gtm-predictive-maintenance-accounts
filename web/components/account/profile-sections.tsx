import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type Profile = {
  checkedOn: string;
  about: { label: string; text: string; source: string }[];
  news: { date: string; headline: string; action: string; caution: string; source: string }[];
};

const Source = ({ url }: { url: string }) => (
  <a href={url} target="_blank" rel="noreferrer" className="whitespace-nowrap text-muted-foreground underline">
    Source: {new URL(url).hostname.replace(/^www\./, "")}
  </a>
);

/** "About the company" and "Recent news" on the battle card. Every item has its own source. */
export function ProfileSections({ profile }: { profile: Profile | null }) {
  if (!profile) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">About the company and recent news</CardTitle></CardHeader>
        <CardContent><p className="text-muted-foreground">Not researched yet for this account.</p></CardContent>
      </Card>
    );
  }
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">About the company</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <dl className="grid gap-x-4 gap-y-2 md:grid-cols-[160px_minmax(0,1fr)]">
            {profile.about.map((item) => (
              <div key={item.label} className="contents">
                <dt className="text-muted-foreground">{item.label}</dt>
                <dd>{item.text} <Source url={item.source} /></dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground">Company claims are not verified. Checked {profile.checkedOn}.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Recent news</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y">
            {[...profile.news].sort((a, b) => b.date.localeCompare(a.date)).map((item) => (
              <li key={item.source} className="flex flex-col gap-1 py-3 first:pt-0 md:flex-row md:gap-4">
                <span className="shrink-0 tabular-nums text-muted-foreground md:w-[160px]">{item.date}</span>
                <div className="min-w-0">
                  <p className="font-medium">{item.headline}</p>
                  <p><b>What to do:</b> {item.action}</p>
                  <p className="text-muted-foreground">{item.caution} <Source url={item.source} /></p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
