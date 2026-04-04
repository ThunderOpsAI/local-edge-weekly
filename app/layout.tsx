import type { Metadata } from "next";
import Link from "next/link";

import { getAccountContext, getAuthenticatedUser } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "Local Edge",
  description: "Local market monitoring for business owners who want the signal without the research burden.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [user, context] = await Promise.all([getAuthenticatedUser(), getAccountContext()]);

  return (
    <html lang="en">
      <body>
        <main>
          <div className="shell">
            <header className="topbar">
              <div className="brand">
                <p className="eyebrow">Local Edge</p>
                <h1>Your local market, explained in plain English.</h1>
              </div>
              <div className="page-actions">
                {user ? (
                  <>
                    <Link href="/" className="button button-secondary">
                      Home
                    </Link>
                    {context?.role === "owner" ? (
                      <Link href="/admin" className="button button-secondary">
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
              </div>
            </header>
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
