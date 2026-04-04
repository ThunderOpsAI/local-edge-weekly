"use client";

import { useState, useTransition } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    startTransition(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setError("Supabase is not configured in this environment.");
        return;
      }

      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (signInError) {
        setError(signInError.message);
        return;
      }

      setNotice("Magic link sent. Check your inbox and return through the email link.");
    });
  }

  return (
    <form className="panel form-shell" onSubmit={onSubmit}>
      <div>
        <p className="eyebrow">Magic Link Login</p>
        <h2>Sign in to your Local Edge account</h2>
        <p className="muted">
          We send a passwordless login link to your email. When you return, the session is stored
          in secure cookies for the app.
        </p>
      </div>

      <label className="field">
        <span>Email address</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="owner@example.com"
          required
        />
      </label>

      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <div className="page-actions">
        <button type="submit" className="button button-primary" disabled={isPending}>
          {isPending ? "Sending link..." : "Send magic link"}
        </button>
      </div>
    </form>
  );
}
