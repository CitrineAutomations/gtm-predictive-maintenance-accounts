"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type Item = { href: string; label: string };

const WORK: Item[] = [
  { href: "/", label: "Accounts" },
  { href: "/contacts", label: "Contacts" },
  { href: "/activity", label: "Activity" },
];
const LEARN: Item[] = [
  { href: "/test", label: "60-day test" },
  { href: "/playbook", label: "Playbook" },
];

const isCurrent = (path: string, href: string) =>
  href === "/" ? path === "/" || path.startsWith("/accounts") : path.startsWith(href);

export function Nav({ companies }: { companies: { id: string; name: string }[] }) {
  const path = usePathname();
  const router = useRouter();

  const group = (title: string, items: Item[]) => (
    <>
      <div className="hidden px-3 pt-4 pb-1 text-xs uppercase tracking-wider text-muted-foreground md:block">{title}</div>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isCurrent(path, item.href) ? "page" : undefined}
          className="flex justify-between gap-2 rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:bg-muted aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
        >
          {item.label}
          {item.href === "/" ? <span className="tabular-nums">{companies.length}</span> : null}
        </Link>
      ))}
    </>
  );

  return (
    <aside className="flex flex-col gap-1 border-b bg-sidebar p-3 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
      <div className="px-2 pb-2 font-bold">Target Accounts</div>
      <input
        list="company-names"
        placeholder="Go to company"
        aria-label="Go to company"
        className="h-9 rounded-md border bg-background px-3"
        onChange={(event) => {
          const hit = companies.find((c) => c.name === event.target.value);
          if (hit) {
            event.target.value = "";
            router.push(`/accounts/${hit.id}`);
          }
        }}
      />
      <datalist id="company-names">
        {companies.map((c) => <option key={c.id} value={c.name} />)}
      </datalist>
      <nav className="flex flex-wrap gap-1 md:flex-col">
        {group("Work", WORK)}
        {group("Learn", LEARN)}
      </nav>
    </aside>
  );
}
