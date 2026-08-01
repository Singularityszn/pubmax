// Clerk sign-in and sign-up, added BESIDE Supabase auth (never replacing it).
//
// WHAT A CLERK ACCOUNT IS NOT (yet):
// a Clerk account is not a PUBMAXX User ID and it carries no PUBMAXX Handle.
// Ownership, moderation, authorship and consent still attach to the Supabase
// account (CONTEXT.md, "PUBMAXX User ID"). Nine Supabase migrations key their
// row-level-security policies on `auth.uid()`, so a Clerk account cannot claim
// a contribution until that policy question is decided and migrated. Copy on
// any Clerk surface must therefore never promise a handle, a contribution, or
// carried-over history. See components/auth/ClerkAccountControls.tsx.
//
// WHY THE ORIGINS ARE DERIVED, NOT HARDCODED:
// a Clerk publishable key is `pk_<test|live>_<base64>` whose payload decodes to
// the instance Frontend API host followed by a `$` terminator. The browser
// loads clerk-js FROM that host and calls it for every session request, so the
// host is exactly what proxy.ts must admit in `script-src` and `connect-src`.
// Deriving it from the key means a development instance, a production instance
// and a future key rotation each get their own single exact origin, and no
// directive ever has to widen to a wildcard host.

/** The public env var carrying the instance key. Safe to expose to browsers. */
export const CLERK_PUBLISHABLE_KEY_ENV = "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY";

/** The server-only env var. NEVER read it into a NEXT_PUBLIC_* value. */
export const CLERK_SECRET_KEY_ENV = "CLERK_SECRET_KEY";

/**
 * Cloudflare Turnstile, which Clerk uses for bot protection on sign-up.
 * Needed by `script-src` (the challenge widget) and `frame-src` (its iframe).
 */
export const CLERK_BOT_PROTECTION_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Clerk's abuse and fraud protection hosts. This is the ONE Clerk entry with a
 * wildcard, and the wildcard is a subdomain wildcard inside a Clerk-owned
 * registrable domain (never a wildcard directive, never a bare scheme): Clerk
 * shards these per deployment, so the exact subdomain is not knowable here.
 */
export const CLERK_ABUSE_PROTECTION_ORIGIN = "https://*.protect.clerk.com";

/** Clerk's own image CDN, which serves account avatars in <UserButton>. */
export const CLERK_IMAGE_ORIGIN = "https://img.clerk.com";

/**
 * Read the publishable key. Written as a literal `process.env.<NAME>` member
 * expression on purpose — that is the form Next.js statically replaces at build
 * time, so a computed lookup would silently read `undefined` in the browser.
 */
export function readClerkPublishableKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return key && key.trim() ? key.trim() : undefined;
}

/**
 * Whether Clerk may run at all. Everything Clerk-shaped is gated on this, so a
 * deployment with no key keeps exactly today's behaviour instead of failing:
 * clerkMiddleware() throws per request when it cannot find a key, which would
 * turn a missing env var into a site-wide 500 rather than an absent button.
 */
export function isClerkConfigured(
  publishableKey: string | undefined = readClerkPublishableKey(),
): boolean {
  return clerkFrontendApiOrigin(publishableKey) !== null;
}

/**
 * The instance Frontend API origin, decoded from the publishable key.
 *
 * Returns null for anything that is not a well-formed key, which is what makes
 * a malformed value fail CLOSED: no origin means Clerk stays off and the CSP
 * gains nothing, rather than an attacker-supplied host being admitted into
 * `script-src` by a key that merely looked close enough.
 */
export function clerkFrontendApiOrigin(
  publishableKey: string | undefined = readClerkPublishableKey(),
): string | null {
  const key = publishableKey?.trim();
  if (!key) return null;

  const payload =
    key.startsWith("pk_test_") ? key.slice("pk_test_".length)
    : key.startsWith("pk_live_") ? key.slice("pk_live_".length)
    : null;
  if (!payload) return null;

  let decoded: string;
  try {
    decoded = Buffer.from(payload, "base64").toString("utf8");
  } catch {
    return null;
  }

  // The payload is the host plus a single `$` terminator. A payload without it
  // was not a Clerk key, whatever it decoded to.
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1).toLowerCase();

  // A host, and only a host: no scheme, no port, no path, no credentials, no
  // wildcard. This is the fence that stops a crafted key widening the policy.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    return null;
  }

  return `https://${host}`;
}

/** The exact origins each CSP directive must gain for Clerk to work. */
export type ClerkCspSources = {
  script: readonly string[];
  connect: readonly string[];
  img: readonly string[];
  frame: readonly string[];
};

const NO_CLERK_SOURCES: ClerkCspSources = {
  script: [],
  connect: [],
  img: [],
  frame: [],
};

/**
 * Clerk's CSP additions, per Clerk's own CSP guidance
 * (https://clerk.com/docs/guides/secure/best-practices/csp-headers).
 *
 * Empty in every directive when Clerk is not configured, so the shipped policy
 * is byte-for-byte today's policy until the captain sets a key.
 *
 * Deliberately NOT included: `style-src 'unsafe-inline'` and `worker-src blob:`,
 * which Clerk also requires and which proxy.ts already carries for MapLibre.
 * They are listed here in a comment rather than the return value so nothing
 * re-adds them and so a future MapLibre change cannot quietly remove them
 * without a Clerk test noticing (__tests__/clerkProxyCsp.test.ts asserts both).
 */
export function clerkCspSources(
  publishableKey: string | undefined = readClerkPublishableKey(),
): ClerkCspSources {
  const frontendApi = clerkFrontendApiOrigin(publishableKey);
  if (!frontendApi) return NO_CLERK_SOURCES;

  return {
    // clerk-js itself is served from the instance Frontend API host.
    script: [frontendApi, CLERK_BOT_PROTECTION_ORIGIN, CLERK_ABUSE_PROTECTION_ORIGIN],
    // Session, sign-in and sign-up calls go to the same host.
    connect: [frontendApi, CLERK_ABUSE_PROTECTION_ORIGIN],
    // Account avatars only. Clerk uploads are NOT routed via /api/image-proxy
    // because they are first-party account images, not third-party venue photos.
    img: [CLERK_IMAGE_ORIGIN],
    // The Turnstile challenge and the abuse-protection frames.
    frame: [CLERK_BOT_PROTECTION_ORIGIN, CLERK_ABUSE_PROTECTION_ORIGIN],
  };
}
