import { LoginForm } from "@/app/login/login-form";
import { getAuthenticatedUser } from "@/lib/auth";

export default async function LoginPage() {
  const user = await getAuthenticatedUser();

  return (
    <section className="stack">
      <div className="panel hero-panel">
        <p className="eyebrow">Secure Access</p>
        <h2>Owner access is now protected by Supabase Auth.</h2>
        <p className="muted">
          {user
            ? `You are signed in as ${user.email}.`
            : "Sign in with a magic link to access projects, reports, and API routes tied to your account only."}
        </p>
      </div>

      <LoginForm />
    </section>
  );
}
