import type { User } from "@supabase/supabase-js";

import { ensureAccountOwnership } from "@/lib/account-provisioning";
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

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      console.error("Supabase getUser returned an error", error);
      return null;
    }

    return user;
  } catch (error) {
    console.error("Supabase getUser threw unexpectedly", error);
    return null;
  }
}

export async function getAccountContext(): Promise<AccountContext | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return null;
  }
  const supabaseClient = supabase;

  const user = await getAuthenticatedUser();
  if (!user || !user.email) {
    return null;
  }
  const authenticatedUser = user;
  const authenticatedEmail = user.email;

  async function loadMembership() {
    return await supabaseClient
      .from("users")
      .select("account_id, role, email")
      .eq("id", authenticatedUser.id)
      .maybeSingle();
  }

  let { data, error } = await loadMembership();

  if (!data) {
    try {
      const provisioned = await ensureAccountOwnership(authenticatedUser.id, authenticatedEmail);
      if (provisioned) {
        ({ data, error } = await loadMembership());
      }
    } catch (provisionError) {
      console.error("Unable to provision account membership for authenticated user", provisionError);
    }
  }

  if (error || !data) {
    return null;
  }

  return {
    user: authenticatedUser,
    accountId: data.account_id as string,
    role: data.role as "owner" | "member",
    email: data.email as string,
  };
}
