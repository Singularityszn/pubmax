// Community-observation moderation queue for the admin console.
//   GET                    → { prices: ModeratorCommunityPrice[] }
//   POST { action, id, note? } → { ok: true }   action ∈ hide | restore
//
// The complaint side of the community observation path: readers flag a figure or
// a venue signal via POST /api/price-submit { action: "report" }, this route is
// where a human acts on the flag. Same review-action shape and the same admin
// gate (x-admin-token header OR httpOnly session cookie; lib/adminAuth.ts) as
// the Pint Drop and comment queues.
//
// ONE queue, TWO shapes. Each row says which it is (`kind`): a price carries its
// drink and figure, a venue signal its question and categorical answer. This is
// the removal means for a wrong character or step-free claim, so there is no
// separate console and no second API for them.
//
// HIDE, NEVER DELETE. `hide` stamps the observation hidden and `restore` clears
// the stamp; the row, its answer, its date and its report metadata all survive
// either way, so a wrong call is reversible and the audit trail is intact. A
// hidden signal leaves the venue sheet, the corroboration count and the
// established answer together, exactly as a hidden price leaves the map.
//
// A submitter is never identified here: the queue DTO carries the observation
// and its report metadata, and the actor token stays inside the store.

import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  listCommunityPricesForReviewWithStatus,
  moderateCommunityPriceWithState,
} from "@/lib/communityPriceStore";
import {
  syncTrustAfterPriceHidden,
  syncTrustAfterPriceRestored,
} from "@/lib/priceTrustImpact.server";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-prices:${ipKey}`, `admin-prices:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const result = await listCommunityPricesForReviewWithStatus();
  if (result.degraded) {
    return publicApiError("Could not load community prices.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  return jsonNoStore({ prices: result.prices }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const id = readString(body.id);
  if (!id) return publicApiError("Missing report id.", "INVALID_REQUEST", 400);

  const action = readString(body.action);
  if (action !== "hide" && action !== "restore") {
    return publicApiError("Unknown action.", "INVALID_REQUEST", 400);
  }

  try {
    const result = await moderateCommunityPriceWithState(
      id,
      action === "hide",
      readString(body.note),
    );
    if (!result.ok) return publicApiError("Report not found.", "NOT_FOUND", 404);
    if (!result.changed) return jsonNoStore({ ok: true }, { status: 200 });
    if (action === "hide") {
      await syncTrustAfterPriceHidden(id);
    } else {
      await syncTrustAfterPriceRestored(id);
    }
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch {
    return publicApiError("Moderation is unavailable right now.", "UNAVAILABLE", 503, { retryable: true });
  }
}
