import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

function deriveAccountName(email: string) {
  const localPart = email.split("@")[0] ?? "Local Edge";
  const trimmed = localPart.replace(/[._-]+/g, " ").trim();
  return trimmed.length > 0 ? `${trimmed} account` : "Local Edge account";
}

export async function ensureAccountOwnership(userId: string, email: string) {
  const serviceRole = getSupabaseServiceRoleClient();
  if (!serviceRole) {
    return false;
  }

  const { data: existingMembership, error: membershipLookupError } = await serviceRole
    .from("users")
    .select("id, account_id")
    .eq("id", userId)
    .maybeSingle();

  if (membershipLookupError) {
    throw membershipLookupError;
  }

  if (existingMembership) {
    return true;
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

  return true;
}
