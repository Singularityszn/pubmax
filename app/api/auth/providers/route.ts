// GET /api/auth/providers — which social sign-in buttons, and whether the
// phone door, are enabled.
//
// The browser used to call Supabase `/auth/v1/settings` itself, which opened a
// new origin (DNS, TLS, and a CORS preflight) on every signed-out page. This
// route does that read on the server. The shared cache holds a successful
// answer for a few minutes; `?fresh=1` is the recheck immediately before OAuth
// and is not cached. A missed read is an error, not an all-disabled answer.

import { publicApiError } from "@/lib/apiError";
import { jsonCached, jsonNoStore } from "@/lib/apiResponses";
import { readSupabaseAuthSettings } from "@/lib/authProviderAvailability";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

// Dashboard flags change without a deploy, so this is minutes, not the
// static-data hour. Vercel drops the edge copy on the next deploy anyway.
const PROVIDER_EDGE_MAX_AGE_SECONDS = 300;
const PROVIDER_STALE_WHILE_REVALIDATE_SECONDS = 60;

// `?fresh=1` skips the edge and goes to Supabase every time, so that lane alone
// spends a per-address budget. One sign-in needs one recheck; the cached lane
// is answered by the edge and needs none.
const FRESH_RECHECK_LIMIT = 30;
const FRESH_RECHECK_WINDOW_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  if (fresh) {
    const key = `auth-providers-fresh:${hashIp(clientIp(request))}`;
    if (await isLimited(key, key, FRESH_RECHECK_LIMIT, FRESH_RECHECK_WINDOW_MS)) {
      return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
        retryable: true,
      });
    }
  }
  const settings = await readSupabaseAuthSettings();
  if (!settings) {
    return publicApiError(
      "Sign-in providers could not be read.",
      "PROVIDER_SETTINGS_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  // The phone flag rides beside the three social flags. Older readers parse
  // only the three and ignore it.
  const availability = { ...settings.social, phone: settings.phone };
  if (fresh) return jsonNoStore(availability);
  return jsonCached(availability, {
    sMaxAge: PROVIDER_EDGE_MAX_AGE_SECONDS,
    staleWhileRevalidate: PROVIDER_STALE_WHILE_REVALIDATE_SECONDS,
  });
}
