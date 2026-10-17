import "server-only";

import {
  supabaseCspOriginsFromEnv,
  type SupabaseCspOrigins,
} from "@/lib/contentSecurityPolicy.mjs";

export type { SupabaseCspOrigins };

/**
 * Exact Supabase origins for CSP connect-src / img-src. Wildcard `*.supabase.co`
 * would allow exfiltration to any tenant project; pin the configured project host
 * instead (same idea as clerkCspSources in lib/clerkIdentity.ts). The parser
 * lives in lib/contentSecurityPolicy.mjs so next.config.mjs reads the same pin.
 */
export function supabaseCspOrigins(
  env: Record<string, string | undefined> = process.env,
): SupabaseCspOrigins | null {
  return supabaseCspOriginsFromEnv(env);
}
