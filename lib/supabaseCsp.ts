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

/** Exact local auth origins for the explicitly enabled production QA server. */
export function localQaSupabaseConnectOrigins(
  env: Record<string, string | undefined>,
  documentUrl: string,
): readonly string[] {
  if (
    env.NODE_ENV !== "production" ||
    env.VERCEL_ENV !== "development" ||
    env.PUBMAX_E2E_LOGIN !== "1" ||
    env.VERCEL === "1"
  ) return [];

  // Accept literal loopback hosts only. Do not admit DNS aliases or URL credentials.
  if (!/^http:\/\/(?:localhost|127\.0\.0\.1):[1-9]\d{3,4}(?:\/|$)/.test(documentUrl)) {
    return [];
  }
  const publicUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serverUrl = env.SUPABASE_URL?.trim();
  // 54321 is the stock local API port. 58441 is the owned recovery stack.
  const localApi = /^http:\/\/(?:localhost|127\.0\.0\.1):(?:54321|58441)\/?$/;
  if (!publicUrl || !serverUrl || !localApi.test(publicUrl) || !localApi.test(serverUrl)) {
    return [];
  }

  try {
    const document = new URL(documentUrl);
    const documentPort = Number(document.port);
    if (documentPort < 1024 || documentPort > 65535) return [];
    const publicOrigin = new URL(publicUrl).origin;
    if (publicOrigin !== new URL(serverUrl).origin) return [];
    return [publicOrigin, publicOrigin.replace(/^http:/, "ws:")];
  } catch {
    return [];
  }
}
