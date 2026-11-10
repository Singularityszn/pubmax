import "server-only";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * The email address on a verified operator's own account, or null.
 *
 * Read from Supabase Auth through the service role, never from a request body
 * and never from a venue record, so a request for a table reaches the person
 * who proved they run the pub and nobody else. A deployment without Auth
 * returns null. The address is handed to the email seam alone: it is never returned
 * to a browser and never logged.
 *
 * A confirmed deleted account returns null. Unavailable Auth lookups throw
 * so delivery can distinguish an unknown address from a confirmed absence.
 */
export async function operatorAccountAddress(accountId: string): Promise<string | null> {
  if (!accountId || !isSupabaseConfigured()) return null;
  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Operator account lookup unavailable");
  const { data, error } = await supabase.auth.admin.getUserById(accountId);
  if (error?.code === "user_not_found") return null;
  if (error) throw error;
  const email = data.user?.email?.trim();
  return email ? email : null;
}
