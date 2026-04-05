import { NextResponse } from "next/server";

import { ensureAccountOwnership } from "@/lib/account-provisioning";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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

  try {
    await ensureAccountOwnership(user.id, user.email);
  } catch (error) {
    console.error("Failed to provision account during auth callback", error);
    return NextResponse.redirect(new URL(`/login?error=account_setup_failed`, requestUrl.origin));
  }

  return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
}
