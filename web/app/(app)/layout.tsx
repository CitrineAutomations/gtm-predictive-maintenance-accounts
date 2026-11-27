import { Nav } from "@/components/shell/nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const companies = await prisma.company.findMany({
    where: { rank: { not: null } },
    orderBy: { rank: "asc" },
    select: { id: true, name: true },
  });
  return (
    <div className="grid min-h-screen grid-cols-1 content-start md:grid-cols-[220px_minmax(0,1fr)] md:content-stretch">
      <Nav companies={companies} />
      <div className="min-w-0">
        <header className="flex items-center gap-3 border-b px-5 py-2">
          <span className="text-muted-foreground">{user.email}</span>
          <ThemeToggle />
        </header>
        <main className="flex max-w-6xl flex-col gap-4 px-5 py-5">{children}</main>
      </div>
    </div>
  );
}
