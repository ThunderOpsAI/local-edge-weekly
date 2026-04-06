import { NextResponse } from "next/server";

import { ensureAccountOwnership } from "@/lib/account-provisioning";
import { buildPublicUrl } from "@/lib/request-url";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") ? next : "/";

  if (!code) {
    return NextResponse.redirect(buildPublicUrl(request, `/login?error=missing_code`));
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.redirect(buildPublicUrl(request, `/login?error=supabase_not_configured`));
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(buildPublicUrl(request, `/login?error=auth_callback_failed`));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return NextResponse.redirect(buildPublicUrl(request, `/login?error=user_missing`));
  }

  try {
    await ensureAccountOwnership(user.id, user.email);
  } catch (error) {
    console.error("Failed to provision account during auth callback", error);
    return NextResponse.redirect(buildPublicUrl(request, `/login?error=account_setup_failed`));
  }

  return NextResponse.redirect(buildPublicUrl(request, safeNext));
}
