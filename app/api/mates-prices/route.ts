import { assertServerEnv } from "@/lib/serverEnv";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { log } from "@/lib/log";
import { readMatesPrices } from "@/lib/matesPrices.server";
import type { MatesPricesAnswer } from "@/lib/matesPrices";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { hashActor } from "@/lib/supabase";

assertServerEnv();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const READ_LIMIT = 120;
const READ_WINDOW_MS = 60_000;
const VENUE_ID = /^[A-Za-z0-9][A-Za-z0-9_:.-]{0,99}$/;

/**
 * GET /api/mates-prices?venueId=...: what the reader's mutual friends last
 * paid at one pub. Up to three dated facts, one per mate, from their priced
 * public Pint Drops, read live and answered to the reader alone. A reader
 * with no verified Social session gets the access answer (401 signed out);
 * a reader whose mates have not logged here gets an empty list.
 */
export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) {
    return publicApiError(access.error, access.code, access.status, {
      retryable: access.retryable === true,
      headers: NO_STORE,
    });
  }
  const venueId = new URL(request.url).searchParams.get("venueId") ?? "";
  if (!VENUE_ID.test(venueId)) {
    return publicApiError("Choose a pub.", "INVALID_VENUE", 400, { headers: NO_STORE });
  }
  const key = `mates-prices:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, READ_LIMIT, READ_WINDOW_MS)) {
    return publicApiError("Too many requests. Slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      headers: NO_STORE,
    });
  }
  try {
    const prices = await readMatesPrices(access.actor, venueId);
    const answer: MatesPricesAnswer = { prices };
    return jsonNoStore(answer, { headers: NO_STORE });
  } catch (err) {
    log("error", "mates_prices.read_failed", {
      route: "GET /api/mates-prices",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Your mates' prices are unavailable right now.", "MATES_PRICES_UNAVAILABLE", 503, {
      retryable: true,
      headers: NO_STORE,
    });
  }
}
