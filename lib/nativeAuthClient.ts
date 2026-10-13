import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthAttemptId } from "@/lib/authRedirect";
import { withAuthFetchTimeout } from "@/lib/authFetch";
import { resolveSupabaseConfig } from "@/lib/supabaseConfig";

/** A disposable PKCE client. Supabase uses its private memory storage when persistence is disabled. */
export async function createNativeAuthClient(attemptId: string): Promise<SupabaseClient | null> {
  if (!isAuthAttemptId(attemptId)) return null;
  const config = resolveSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { expectedKeyRole: "publishable", allowUnknownKeyRole: process.env.NODE_ENV !== "production" },
  );
  if (!config) return null;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(config.url, config.key, {
    global: { fetch: withAuthFetchTimeout(globalThis.fetch.bind(globalThis)) },
    auth: {
      storageKey: `pubmax-native-auth-${attemptId}`,
      flowType: "pkce",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
