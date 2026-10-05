import { AUTH_BROWSER_FETCH_TIMEOUT_MS, withAuthFetchTimeout } from "@/lib/authFetch";
import { clerkFrontendApiOrigin } from "@/lib/clerkIdentity";

export type SocialAuthProvider = "google" | "apple" | "microsoft";

export type SocialAuthProviderAvailability = Record<SocialAuthProvider, boolean>;

export const NO_SOCIAL_AUTH_PROVIDERS: SocialAuthProviderAvailability = {
  google: false,
  apple: false,
  microsoft: false,
};

export function hasSocialAuthProviders(
  availability: SocialAuthProviderAvailability,
): boolean {
  return availability.google || availability.apple || availability.microsoft;
}

type AuthStartResult = { error: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function availabilityFromClerkEnvironment(
  environment: unknown,
): SocialAuthProviderAvailability | null {
  if (!isRecord(environment) || !isRecord(environment.userSettings)) return null;
  const social = environment.userSettings.social;
  if (!isRecord(social)) return null;

  const enabledStrategies = new Set(
    Object.entries(social).flatMap(([key, value]) => {
      if (!isRecord(value) || value.enabled !== true) return [];
      return [typeof value.strategy === "string" ? value.strategy : key];
    }),
  );

  return {
    google: enabledStrategies.has("oauth_google"),
    apple: enabledStrategies.has("oauth_apple"),
    microsoft: false,
  };
}

/** Same-origin read of provider flags. The browser never calls Supabase for this. */
export const SOCIAL_AUTH_PROVIDERS_PATH = "/api/auth/providers";

function socialAuthProvidersUrl(fresh: boolean): string {
  return fresh ? `${SOCIAL_AUTH_PROVIDERS_PATH}?fresh=1` : SOCIAL_AUTH_PROVIDERS_PATH;
}

function availabilityFromApiPayload(
  payload: unknown,
): SocialAuthProviderAvailability | null {
  if (!isRecord(payload)) return null;
  if (
    typeof payload.google !== "boolean" ||
    typeof payload.apple !== "boolean" ||
    typeof payload.microsoft !== "boolean"
  ) {
    return null;
  }
  return {
    google: payload.google,
    apple: payload.apple,
    microsoft: payload.microsoft,
  };
}

/**
 * Read a refusal to the end, or cancel it. Chromium keeps a response whose
 * body is never read in flight, so the page would never reach network idle.
 * withAuthFetchTimeout stops its clock once the headers arrive, so this read
 * keeps its own deadline: a stalled body must not hold sign-in pending.
 */
async function discardRefusalBody(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const deadline = setTimeout(() => {
    void reader.cancel().catch(() => {});
  }, AUTH_BROWSER_FETCH_TIMEOUT_MS);
  try {
    while (!(await reader.read()).done) {
      // The refusal's content is not used.
    }
  } catch {
    // A cancelled or broken body is still a finished read.
  } finally {
    clearTimeout(deadline);
    reader.releaseLock();
  }
}

/**
 * Read which social providers are enabled. The browser calls the same-origin
 * route so a signed-out page does not open a third-party connection. Credentials
 * stay `same-origin` so a Vercel deployment-protection cookie is sent on that
 * read and is not attached to any other host. `fresh` skips the shared cache
 * and is the recheck immediately before OAuth starts.
 * Unknown is distinct from an all-disabled response so callers can fail closed
 * without claiming the read succeeded.
 */
export async function loadSocialAuthProviders(
  fetchImpl: typeof fetch = globalThis.fetch,
  options: { fresh?: boolean } = {},
): Promise<SocialAuthProviderAvailability | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return null;

  try {
    const response = await withAuthFetchTimeout(fetchImpl)(
      socialAuthProvidersUrl(options.fresh === true),
      { credentials: "same-origin" },
    );
    if (!response.ok) {
      await discardRefusalBody(response);
      return null;
    }
    return availabilityFromApiPayload(await response.json());
  } catch {
    return null;
  }
}

/**
 * Server-side read of Supabase Auth's public provider settings. The publishable
 * key stays on this request so the browser never sends a cross-origin `apikey`
 * header. Unknown is distinct from an all-disabled response.
 */
export async function readSupabaseSocialAuthProviders(
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
      apple: payload.external.apple === true,
      microsoft: payload.external.azure === true,
    };
  } catch {
    return null;
  }
}

/**
 * Read Clerk's public instance environment for enabled OAuth strategies. Clerk
 * exposes the configured social set through user_settings.social, so provider
 * availability follows dashboard changes without a second application list.
 */
export async function loadClerkSocialAuthProviders(
  fetchImpl: typeof fetch = globalThis.fetch,
  clerkEnvironment?: unknown,
): Promise<SocialAuthProviderAvailability | null> {
  if (clerkEnvironment !== undefined) {
    return availabilityFromClerkEnvironment(clerkEnvironment);
  }

  const frontendApi = clerkFrontendApiOrigin();
  if (!frontendApi) return null;

  let environmentUrl: string;
  try {
    environmentUrl = new URL("/v1/environment", frontendApi).toString();
  } catch {
    return null;
  }

  try {
    const response = await withAuthFetchTimeout(fetchImpl)(environmentUrl, {
      cache: "no-store",
    });
    if (!response.ok) return null;

    const payload: unknown = await response.json();
    return availabilityFromClerkEnvironment(
      isRecord(payload) && isRecord(payload.user_settings)
        ? { userSettings: payload.user_settings }
        : null,
    );
  } catch {
    return null;
  }
}

function unavailableMessage(provider: SocialAuthProvider): string {
  const name =
    provider === "google"
      ? "Google"
      : provider === "apple"
        ? "Apple"
        : "Microsoft";
  return `${name} sign-in isn't available right now. Use email instead.`;
}

/**
 * Recheck the selected provider immediately before OAuth starts. This closes
 * the stale-page gap where a provider can be disabled after initial render.
 */
export async function guardSocialAuthProvider(
  provider: SocialAuthProvider,
  start: () => Promise<AuthStartResult>,
  load: () => Promise<SocialAuthProviderAvailability | null> = () =>
    loadSocialAuthProviders(globalThis.fetch, { fresh: true }),
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
