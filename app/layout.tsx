import type { Metadata } from "next";
import Link from "next/link";
import { Manrope, Fraunces } from "next/font/google";

import { getAccountContext, getAuthenticatedUser } from "@/lib/auth";
import "./globals.css";

const sans = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
});

const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "Local Edge",
  description: "Local market monitoring for business owners who want the signal without the research burden.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, context] = await Promise.all([getAuthenticatedUser(), getAccountContext()]);

  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable}`}>
        <main>
          <div className="shell">
            <header className="topbar">
              <Link href="/" className="brand-mark">
                <span className="brand-dot" />
                <span>Local Edge</span>
              </Link>
              <nav className="topnav">
                {user ? (
                  <>
                    <Link href="/" className="button button-ghost">
                      Home
                    </Link>
                    {context?.role === "owner" ? (
                      <Link href="/admin" className="button button-ghost">
                        Admin
                      </Link>
                    ) : null}
                    <Link href="/projects/new" className="button button-primary">
                      New Project
                    </Link>
                  </>
                ) : (
                  <Link href="/login" className="button button-primary">
                    Sign in
                  </Link>
                )}
              </nav>
            </header>
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
