import "server-only";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

/**
 * The email address on a verified operator's own account, or null.
 *
 * Read from Supabase Auth through the service role, never from a request body
 * and never from a venue record, so a request for a table reaches the person
 * who proved they run the pub and nobody else. A keyless deployment has no
 * Auth and answers null, which the table-request delivery treats as "not
 * sent". The address is handed to the email seam alone: it is never returned
 * to a browser and never logged.
 */
export async function operatorAccountAddress(accountId: string): Promise<string | null> {
  if (!accountId || !isSupabaseConfigured()) return null;
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.admin.getUserById(accountId);
    if (error) return null;
    const email = data.user?.email?.trim();
    return email ? email : null;
  } catch {
    return null;
  }
}
