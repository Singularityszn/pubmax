// GET /api/auth/providers — which social sign-in buttons are enabled.
//
// The browser used to call Supabase `/auth/v1/settings` itself, which opened a
// new origin (DNS, TLS, and a CORS preflight) on every signed-out page. This
// route does that read on the server. The shared cache holds a successful
// answer for a few minutes; `?fresh=1` is the recheck immediately before OAuth
// and is not cached. A missed read is an error, not an all-disabled answer.

import { publicApiError } from "@/lib/apiError";
import { jsonCached, jsonNoStore } from "@/lib/apiResponses";
import { readSupabaseSocialAuthProviders } from "@/lib/authProviderAvailability";

// Dashboard flags change without a deploy, so this is minutes, not the
// static-data hour. Vercel drops the edge copy on the next deploy anyway.
const PROVIDER_EDGE_MAX_AGE_SECONDS = 300;
const PROVIDER_STALE_WHILE_REVALIDATE_SECONDS = 60;

export async function GET(request: Request): Promise<Response> {
  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const availability = await readSupabaseSocialAuthProviders();
  if (!availability) {
    return publicApiError(
      "Sign-in providers could not be read.",
      "PROVIDER_SETTINGS_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (fresh) return jsonNoStore(availability);
  return jsonCached(availability, {
    sMaxAge: PROVIDER_EDGE_MAX_AGE_SECONDS,
    staleWhileRevalidate: PROVIDER_STALE_WHILE_REVALIDATE_SECONDS,
  });
}
