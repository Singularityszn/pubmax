// Email-capture domain helpers — validation, normalisation, source allowlist,
// and unsubscribe-token minting for the lightweight email path on the identity
// nudge sheet (Cycle-2 locked owner decision: "push identity harder — early
// email capture"). Browser-safe: no Supabase / node-only imports here so a
// "use client" component can share the exact validation the route enforces.
//
// The store (lib/emailSubscribersStore.ts) and the route
// (app/api/email-subscribers/route.ts) both import from here so client and
// server agree on what a valid email is — no fake success on the client that the
// server would then reject.

/** Where a capture happened. Constrained to a known allowlist so a spoofed body
 *  can't invent an arbitrary source (mirrors the DB check constraint in 0042). */
export const EMAIL_SUBSCRIBER_SOURCES = ["identity-nudge"] as const;
export type EmailSubscriberSource = (typeof EMAIL_SUBSCRIBER_SOURCES)[number];

/** RFC-pragmatic max length; addresses longer than this are rejected outright. */
export const MAX_EMAIL_LENGTH = 254;

/**
 * Deliberately strict, single-line address sanity check — the SAME shape the
 * digest uses (feat/email-digest lib/weeklyDigest.ts isLikelyEmail), kept in
 * step on purpose so a captured address the digest would later reject can never
 * be stored as "valid" here. Requires exactly one non-space run, an `@`, another
 * non-space run, a dot, and a TLD-ish run. This is defence-in-depth, NOT a
 * deliverability guarantee — the email provider is the real validator.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lower-case + trim; the single normalisation applied before validation and
 *  before any durable write, so `Foo@Bar.com ` and `foo@bar.com` are one row. */
export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** True when `value` is a plausibly-valid email once normalised. */
export function isValidEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email);
}

/**
 * Normalise + validate in one step. Returns the normalised address when valid,
 * or null — callers never re-normalise, so client and server store the identical
 * canonical form.
 */
export function parseEmail(value: unknown): string | null {
  const email = normalizeEmail(value);
  return isValidEmail(email) ? email : null;
}

/** True when `value` is a known capture source. */
export function isValidSource(value: unknown): value is EmailSubscriberSource {
  return (
    typeof value === "string" &&
    (EMAIL_SUBSCRIBER_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * Coerce an optional body `source` to a valid source, defaulting to
 * 'identity-nudge' (the only surface today). An unknown value is NOT trusted —
 * it collapses to the default rather than being stored raw.
 */
export function coerceSource(value: unknown): EmailSubscriberSource {
  return isValidSource(value) ? value : "identity-nudge";
}

/**
 * Mint an opaque, URL-safe unsubscribe/confirm token. One token per row backs
 * BOTH the confirm link and the unsubscribe link, so no email address ever
 * travels in a URL. Uses Web Crypto (available in the Next.js runtime and node
 * ≥ 18) with a non-crypto fallback that is still unguessable enough for a
 * capability token of this sensitivity.
 */
export function mintUnsubscribeToken(): string {
  try {
    const bytes = new Uint8Array(24);
    (globalThis.crypto as Crypto).getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // Extremely unlikely (no Web Crypto) — fall back to a still-opaque token.
    return (
      Date.now().toString(36) +
      Math.random().toString(36).slice(2) +
      Math.random().toString(36).slice(2)
    );
  }
}
