import { NextResponse } from "next/server";

import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function deriveAccountName(email: string) {
  const localPart = email.split("@")[0] ?? "Local Edge";
  const trimmed = localPart.replace(/[._-]+/g, " ").trim();
  return trimmed.length > 0 ? `${trimmed} account` : "Local Edge account";
}

async function ensureAccountOwnership(userId: string, email: string) {
  const serviceRole = getSupabaseServiceRoleClient();
  if (!serviceRole) {
    return;
  }

  const { data: existingMembership } = await serviceRole
    .from("users")
    .select("id, account_id")
    .eq("id", userId)
    .maybeSingle();

  if (existingMembership) {
    return;
  }

  const { data: account, error: accountError } = await serviceRole
    .from("accounts")
    .insert({
      name: deriveAccountName(email),
      plan: "trial",
    })
    .select("id")
    .single();

  if (accountError) {
    throw accountError;
  }

  const { error: membershipError } = await serviceRole.from("users").insert({
    id: userId,
    account_id: account.id,
    email,
    role: "owner",
  });

  if (membershipError) {
    throw membershipError;
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") ? next : "/";

  if (!code) {
    return NextResponse.redirect(new URL(`/login?error=missing_code`, requestUrl.origin));
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(new URL(`/login?error=supabase_not_configured`, requestUrl.origin));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=auth_callback_failed`, requestUrl.origin));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.redirect(new URL(`/login?error=user_missing`, requestUrl.origin));
  }

  await ensureAccountOwnership(user.id, user.email);

  return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
}
