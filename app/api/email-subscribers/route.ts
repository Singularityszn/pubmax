// Email-capture route — backs the LIGHTWEIGHT email path on the identity nudge
// sheet (IdentityNudge). A signed-out user who declines full OAuth can leave
// just an email to receive the weekly pint digest. This is the ONLY purpose the
// address is captured for, stated at capture (GDPR-sane purpose limitation).
//
//   POST { email, source? } → { ok: true, status, confirmed, confirmationSent }
//
// Double-opt-in by construction: the address is stored UNCONFIRMED
// (lib/emailSubscribersStore.ts) and a provider-gated confirmation email is
// dispatched (lib/emailConfirmation.ts — INERT until email keys exist). The
// weekly digest treats an unconfirmed subscriber as NOT opted in, so nothing is
// ever mailed without an explicit confirm. The unsubscribe token NEVER leaves
// the server — it only ever appears inside the confirm/unsubscribe links.
//
// Abuse boundary (write-surface certification): PUBLIC keyless contribution
// path, so it fails soft like Pint Drops / Price Confirms — durable per-IP AND
// global rate limits in production, a tightened degraded budget on transient
// limiter failure, and the in-memory limiter for keyless dev. A durable STORE
// write failure answers 503 (house rule: degraded dependency, never fake
// success).

import { jsonNoStore } from "@/lib/apiResponses";
import { dispatchConfirmationEmail } from "@/lib/emailConfirmation";
import { coerceSource, parseEmail } from "@/lib/emailSubscribers";
import { emailSubscribersStore } from "@/lib/emailSubscribersStore";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

// Per-IP capture budget: a handful of addresses per window from one origin is
// plenty for a genuine user (they own one email); more is abuse.
const PER_IP_LIMIT = 5;
// Global capture budget across ALL origins — a cheap circuit breaker so a
// distributed flood can't fill the table even from many IPs.
const GLOBAL_LIMIT = 120;
const WINDOW_MS = 60_000;

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const email = parseEmail(body.email);
  if (!email) {
    // Honest validation — no fake success. The client validates the same way
    // (lib/emailSubscribers.ts) so this is a defence-in-depth 400.
    return jsonNoStore({ error: "Enter a valid email address." }, { status: 400 });
  }
  const source = coerceSource(body.source);

  // Two durable axes: per-IP (abuse from one origin) AND global (distributed
  // flood). Either tripping is a 429. Public contribution posture — NOT
  // fail-closed: a transient limiter outage degrades to a tighter budget rather
  // than refusing genuine sign-ups (see lib/pintDrops.isLimited).
  const ipHash = hashIp(clientIp(request));
  const perIpKey = `email-capture:ip:${ipHash}`;
  const globalKey = "email-capture:global";
  if (
    (await isLimited(perIpKey, perIpKey, PER_IP_LIMIT, WINDOW_MS)) ||
    (await isLimited(globalKey, globalKey, GLOBAL_LIMIT, WINDOW_MS))
  ) {
    return jsonNoStore({ error: "Too many sign-ups right now, try again shortly." }, { status: 429 });
  }

  // Store as an UNCONFIRMED pending subscriber. Idempotent by email: a re-submit
  // returns the existing row without re-confirming or rotating its token.
  const outcome = await emailSubscribersStore().subscribe({ email, source });
  if (outcome.failed) {
    return jsonNoStore(
      { error: "Could not save your email right now. Try again in a moment." },
      { status: 503 },
    );
  }

  // Fire the confirmation email ONLY for a genuinely new, still-unconfirmed row —
  // never re-mail an already-confirmed subscriber, and don't spam a pending one
  // on every re-submit. Provider-gated: INERT (sent:false) until email keys
  // exist, so confirmationSent is a truthful signal for the UI copy.
  let confirmationSent = false;
  if (outcome.status === "created" && !outcome.confirmed && outcome.unsubscribeToken) {
    const origin = new URL(request.url).origin;
    const dispatch = await dispatchConfirmationEmail({
      email,
      origin,
      token: outcome.unsubscribeToken,
    });
    confirmationSent = dispatch.sent;
  }

  // The token is deliberately NOT returned to the browser.
  return jsonNoStore(
    { ok: true, status: outcome.status, confirmed: outcome.confirmed, confirmationSent },
    { status: 200 },
  );
}
