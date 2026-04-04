import type { User } from "@supabase/supabase-js";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export interface AccountContext {
  user: User;
  accountId: string;
  role: "owner" | "member";
  email: string;
}

export async function getAuthenticatedUser(): Promise<User | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return null;
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    return null;
  }

  return user;
}

export async function getAccountContext(): Promise<AccountContext | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return null;
  }

  const user = await getAuthenticatedUser();
  if (!user || !user.email) {
    return null;
  }

  const { data, error } = await supabase
    .from("users")
    .select("account_id, role, email")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    user,
    accountId: data.account_id as string,
    role: data.role as "owner" | "member",
    email: data.email as string,
  };
}
