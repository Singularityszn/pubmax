import "server-only";

/**
 * Exact Supabase origins for CSP connect-src / img-src. Wildcard `*.supabase.co`
 * would allow exfiltration to any tenant project; pin the configured project host
 * instead (same idea as clerkCspSources in lib/clerkIdentity.ts).
 */
export type SupabaseCspOrigins = Readonly<{
  https: string;
  wss: string;
}>;

function originFromEnv(url: string | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    const { protocol, host } = new URL(trimmed);
    if (protocol !== "https:" && protocol !== "http:") return null;
    if (!host.endsWith(".supabase.co")) return null;
    return `${protocol}//${host}`;
  } catch {
    return null;
  }
}

/** Returns pinned https/wss origins, or null when no Supabase project URL is set. */
export function supabaseCspOrigins(
  env: Record<string, string | undefined> = process.env,
): SupabaseCspOrigins | null {
  const https =
    originFromEnv(env.NEXT_PUBLIC_SUPABASE_URL) ?? originFromEnv(env.SUPABASE_URL);
  if (!https) return null;
  const wss = https.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  return { https, wss };
}
