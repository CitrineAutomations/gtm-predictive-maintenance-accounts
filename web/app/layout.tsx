import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Target Accounts", robots: { index: false, follow: false } };

// Apply the saved theme before the first paint, so the page does not flash.
const THEME = "try{var t=localStorage.getItem('crm-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body className="min-h-screen text-sm antialiased">{children}</body>
    </html>
  );
}
