// Community-price moderation queue for the admin console.
//   GET                    → { prices: ModeratorCommunityPrice[] }
//   POST { action, id, note? } → { ok: true }   action ∈ hide | restore
//
// The complaint side of the community price path: readers flag a figure via
// POST /api/price-submit { action: "report" }, this route is where a human acts
// on the flag. Same review-action shape and the same admin gate (x-admin-token
// header OR httpOnly session cookie; lib/adminAuth.ts) as the Pint Drop and
// comment queues.
//
// HIDE, NEVER DELETE. `hide` stamps the observation hidden and `restore` clears
// the stamp; the row, its price, its date and its report metadata all survive
// either way, so a wrong call is reversible and the audit trail is intact.
//
// A submitter is never identified here: the queue DTO carries the observation
// and its report metadata, and the actor token stays inside the store.

import { isModerator } from "@/lib/adminAuth";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  listCommunityPricesForReview,
  moderateCommunityPrice,
} from "@/lib/communityPriceStore";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

function forbidden(): Response {
  return jsonNoStore({ error: "Not authorised." }, { status: 403 });
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-prices:${ipKey}`, `admin-prices:${ipKey}`)) {
    return jsonNoStore({ error: "Too many requests, slow down." }, { status: 429 });
  }

  // listForReview is fail-soft (returns [] on any store error).
  const prices = await listCommunityPricesForReview();
  return jsonNoStore({ prices }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const id = readString(body.id);
  if (!id) return jsonNoStore({ error: "Missing price id." }, { status: 400 });

  const action = readString(body.action);
  if (action !== "hide" && action !== "restore") {
    return jsonNoStore({ error: "Unknown action." }, { status: 400 });
  }

  try {
    const ok = await moderateCommunityPrice(id, action === "hide", readString(body.note));
    if (!ok) return jsonNoStore({ error: "Price not found." }, { status: 404 });
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch {
    return jsonNoStore({ error: "Price moderation is unavailable." }, { status: 503 });
  }
}
