import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Lantern Journal",
    template: "%s · Lantern Journal",
  },
  description: "A publication shaped by EntityKit, Next.js, and Postgres.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Wordmark />
          <nav aria-label="Primary navigation">
            <Link href="/">Journal</Link>
            <Link href="/studio">Studio</Link>
            <Link href="/api/posts">JSON</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          <p>Lantern Journal</p>
          <p>Next.js × EntityKit × Postgres</p>
        </footer>
      </body>
    </html>
  );
}
