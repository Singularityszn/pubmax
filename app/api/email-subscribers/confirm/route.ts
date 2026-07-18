// Double-opt-in COMPLETION endpoint. The confirmation email (provider-gated,
// inert today — lib/emailConfirmation.ts) carries a link to here with the row's
// opaque token. Following it flips the pending subscriber to confirmed, which is
// the ONLY way an address becomes mailable by the weekly digest (#327). The
// token IS the authority (a capability boundary): no email address ever appears
// in the URL, and the token is single-use for confirmation (a second follow of
// an already-confirmed row is a no-op).
//
// GET (not POST) because it is followed from an email link. It is capability-
// gated by the unguessable token and mutates exactly one row it already owns.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { emailSubscribersStore } from "@/lib/emailSubscribersStore";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

const PER_IP_LIMIT = 20;
const WINDOW_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  const token = (new URL(request.url).searchParams.get("token") ?? "").trim();
  if (!token) {
    return publicApiError("Missing confirmation token.", "TOKEN_REQUIRED", 400);
  }

  // Light per-IP rate limit so the token space can't be brute-forced cheaply.
  const key = `email-confirm:ip:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, PER_IP_LIMIT, WINDOW_MS)) {
    return publicApiError("Too many attempts, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const confirmed = await emailSubscribersStore().confirm(token);
  // A false result is either an unknown token or an already-confirmed row. We do
  // NOT distinguish the two to the caller (no token-existence oracle); both read
  // as "nothing more to do".
  return jsonNoStore({ ok: true, confirmed }, { status: 200 });
}
