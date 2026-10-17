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

import {
  CLERK_ABUSE_PROTECTION_ORIGIN,
  CLERK_BOT_PROTECTION_ORIGIN,
  CLERK_IMAGE_ORIGIN,
  clerkCspSourcesFromKey,
  clerkFrontendApiOriginFromKey,
  type ClerkCspSources,
} from "@/lib/contentSecurityPolicy.mjs";

// The origins and both parsers live in lib/contentSecurityPolicy.mjs, which
// next.config.mjs also reads to ship the prerendered documents' policy. They
// are re-exported here so every caller keeps its import.
export {
  CLERK_ABUSE_PROTECTION_ORIGIN,
  CLERK_BOT_PROTECTION_ORIGIN,
  CLERK_IMAGE_ORIGIN,
};
export type { ClerkCspSources };

/**
 * Read the publishable key. Written as a literal `process.env.<NAME>` member
 * expression on purpose — that is the form Next.js statically replaces at build
 * time, so a computed lookup would silently read `undefined` in the browser.
 */
function readClerkPublishableKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return key && key.trim() ? key.trim() : undefined;
}

/** True when the publishable key is a Clerk development instance (`pk_test_*`). */
export function isClerkDevelopmentPublishableKey(
  publishableKey: string | undefined = readClerkPublishableKey(),
): boolean {
  const key = publishableKey?.trim();
  return Boolean(key?.startsWith("pk_test_"));
}

/**
 * Production deploys must not load Clerk with a development publishable key.
 * Preview and local dev keep the current behaviour so Social beta can still
 * exercise Clerk before production keys land.
 */
export function clerkDevelopmentKeyBlockedInProduction(
  publishableKey: string | undefined = readClerkPublishableKey(),
): boolean {
  if (!isClerkDevelopmentPublishableKey(publishableKey)) return false;
  if (process.env.NODE_ENV !== "production") return false;
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "preview" || vercelEnv === "development") return false;
  return true;
}

/**
 * Whether the browser SDK and CSP origins may run. clerk-js needs only the
 * publishable key, but visible account controls also require an established
 * product Supabase session until the identity bridge exists end to end. With
 * no key, nothing Clerk-shaped renders and the Content-Security-Policy is
 * byte-for-byte its pre-Clerk self.
 *
 * A `pk_test_*` key on a production deploy is treated as unconfigured so dev
 * instances never ship to pubmaxxing.com (they hit strict rate limits and log
 * console noise). The captain must add production keys to enable Clerk live.
 */
export function isClerkConfigured(
  publishableKey: string | undefined = readClerkPublishableKey(),
): boolean {
  if (clerkDevelopmentKeyBlockedInProduction(publishableKey)) return false;
  return clerkFrontendApiOrigin(publishableKey) !== null;
}

/**
 * Whether clerkMiddleware() may run. SERVER-ONLY: it reads CLERK_SECRET_KEY, so
 * it must never be called from a client component.
 *
 * This is a SEPARATE and STRICTER gate than isClerkConfigured() on purpose, and
 * the difference is not cosmetic. clerkMiddleware() throws
 * "@clerk/nextjs: Missing secretKey" on EVERY request when the secret key is
 * absent, so a deployment carrying only the publishable key does not get a
 * degraded sign-in: it gets a site-wide 500 on every page, including pages that
 * have nothing to do with identity. Requiring both keys means a half-configured
 * deployment stays a fully working site with Clerk account controls hidden,
 * rather than a site-wide outage.
 */
export function isClerkMiddlewareConfigured(): boolean {
  const secretKey = process.env.CLERK_SECRET_KEY;
  return isClerkConfigured() && Boolean(secretKey && secretKey.trim());
}

/**
 * The instance Frontend API origin, decoded from the publishable key. Null for
 * anything that is not a well-formed key, so a malformed value fails CLOSED.
 * See clerkFrontendApiOriginFromKey for the parser and its fence.
 */
export function clerkFrontendApiOrigin(
  publishableKey: string | undefined = readClerkPublishableKey(),
): string | null {
  return clerkFrontendApiOriginFromKey(publishableKey);
}

/**
 * Clerk's CSP additions, per Clerk's own CSP guidance
 * (https://clerk.com/docs/guides/secure/best-practices/csp-headers). Empty in
 * every directive when Clerk is not configured, so the shipped policy is
 * byte-for-byte today's policy until the captain sets a key. See
 * clerkCspSourcesFromKey for what each directive gains and why.
 */
export function clerkCspSources(
  publishableKey: string | undefined = readClerkPublishableKey(),
): ClerkCspSources {
  return clerkCspSourcesFromKey(publishableKey);
}
