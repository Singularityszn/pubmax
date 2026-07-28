import { withAuthFetchTimeout } from "@/lib/authFetch";

export type SocialAuthProvider = "google" | "microsoft";

export type SocialAuthProviderAvailability = Record<SocialAuthProvider, boolean>;

export const NO_SOCIAL_AUTH_PROVIDERS: SocialAuthProviderAvailability = {
  google: false,
  microsoft: false,
};

type AuthStartResult = { error: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read Supabase Auth's public provider settings. Unknown is distinct from an
 * all-disabled response so callers can fail closed without claiming the read
 * succeeded.
 */
export async function loadSocialAuthProviders(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<SocialAuthProviderAvailability | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return null;

  let settingsUrl: string;
  try {
    settingsUrl = new URL("/auth/v1/settings", supabaseUrl).toString();
  } catch {
    return null;
  }

  try {
    const response = await withAuthFetchTimeout(fetchImpl)(settingsUrl, {
      cache: "no-store",
      headers: { apikey: publishableKey },
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.external)) return null;

    return {
      google: payload.external.google === true,
      microsoft: payload.external.azure === true,
    };
  } catch {
    return null;
  }
}

function unavailableMessage(provider: SocialAuthProvider): string {
  const name = provider === "google" ? "Google" : "Microsoft";
  return `${name} sign-in isn't available right now. Use email instead.`;
}

/**
 * Recheck the selected provider immediately before OAuth starts. This closes
 * the stale-page gap where a provider can be disabled after initial render.
 */
export async function guardSocialAuthProvider(
  provider: SocialAuthProvider,
  start: () => Promise<AuthStartResult>,
  load: () => Promise<SocialAuthProviderAvailability | null> =
    loadSocialAuthProviders,
): Promise<{
  availability: SocialAuthProviderAvailability | null;
  result: AuthStartResult;
}> {
  let availability: SocialAuthProviderAvailability | null = null;
  try {
    availability = await load();
  } catch {
    availability = null;
  }

  if (!availability?.[provider]) {
    return {
      availability,
      result: { error: unavailableMessage(provider) },
    };
  }

  return {
    availability,
    result: await start(),
  };
}
