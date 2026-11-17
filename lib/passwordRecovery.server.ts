import "server-only";

import { createClient } from "@supabase/supabase-js";
import { withAuthFetchTimeout } from "@/lib/authFetch";
import { PASSWORD_RECOVERY_PATH } from "@/lib/passwordRecovery";
import { siteOrigin } from "@/lib/siteUrl";
import { resolveSupabaseConfig } from "@/lib/supabaseConfig";

export async function sendPasswordRecoveryEmail(email: string, currentUrl: string): Promise<void> {
  const config = resolveSupabaseConfig(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { expectedKeyRole: "publishable", allowUnknownKeyRole: process.env.NODE_ENV !== "production" });
  const origin = siteOrigin(currentUrl);
  if (!config || !origin) return;
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: withAuthFetchTimeout(fetch) },
  });
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: new URL(PASSWORD_RECOVERY_PATH, origin).toString(),
  });
  if (error) console.warn("[password-recovery] Email delivery was refused.");
}
