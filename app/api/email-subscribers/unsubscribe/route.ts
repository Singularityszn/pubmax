// Unsubscribe / right-to-erasure endpoint. Every confirmation and digest email
// carries this link with the row's opaque token; following it removes the
// subscriber row entirely (not just a flag), so a confirmed address stops being
// a digest recipient immediately (#327 lists only rows that still exist and are
// confirmed). The token IS the authority (capability boundary) — no email
// address in the URL, and one token backs both confirm and unsubscribe.
//
// GET because it is followed from an email link; capability-gated by the token.

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
    return publicApiError("This unsubscribe link is incomplete.", "TOKEN_REQUIRED", 400);
  }

  const key = `email-unsub:ip:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, PER_IP_LIMIT, WINDOW_MS)) {
    return publicApiError("Too many attempts, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const removed = await emailSubscribersStore().unsubscribe(token);
  // Do not reveal whether the token existed — both cases read as "you are not
  // subscribed", which is the true post-condition either way.
  return jsonNoStore({ ok: true, removed }, { status: 200 });
}
