// The bill check's moderation queue (captain 5 Nov 2026).
//   GET                                 → { checks: ModeratorBillCheck[] }
//   POST { id, decision, note? }        → { ok: true, check }   decision ∈ kept | hidden
//
// A row here is a bill that was read and does NOT show the price it was sent
// with (lib/billCheck.ts `mismatch`). The price it names is still on the pub's
// sheet as `unchecked`, so nothing here is urgent and nothing here is automatic:
// a moderator looks at the submitted price, the lines the bill showed and the
// bill itself, and decides.
//
//   kept    the price stands as it is, still `unchecked`. A misread bill, a
//           round on one line, a happy hour. The check is stamped.
//   hidden  the price leaves every public read through its lane's OWN
//           moderator door: the Pint Drop's hide, the community price's hide
//           and its trust reconciliation.
//
// NEVER DELETED. The check row, the drop and the community price all survive
// either decision, and a hidden price comes back through the queues that
// already restore one. Same admin gate as every other queue (lib/adminAuth.ts).

import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import type { ModeratorBillCheck } from "@/lib/billCheck";
import {
  billCheckStore,
  isBillCheckReviewDecision,
  type BillCheckRecord,
} from "@/lib/billCheckStore";
import { moderateCommunityPriceWithState } from "@/lib/communityPriceStore";
import { drinkMeasureName, statedDrinkMeasure } from "@/lib/drinkMeasure";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { pintDropsStore, resolveStorageUrl } from "@/lib/pintDropsStore";
import { roundsStore } from "@/lib/roundsStore";
import { syncTrustAfterPriceHidden } from "@/lib/priceTrustImpact.server";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { getVenueIndex } from "@/lib/venueIndex";

assertServerEnv();

/** A moderator clears a queue a tap at a time, so this is per minute and wide. */
const MODERATION_WRITE_LIMIT = 60;

/** The note a hidden price carries in its own lane's moderation trail. */
const HIDDEN_NOTE = "Bill check: the bill does not show this price.";

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

function unavailable(): Response {
  return publicApiError("Moderation is unavailable right now.", "UNAVAILABLE", 503, { retryable: true });
}

async function withContext(checks: BillCheckRecord[]): Promise<ModeratorBillCheck[]> {
  const dropIds = checks.flatMap((check) => (check.pintDropId ? [check.pintDropId] : []));
  const [index, drops] = await Promise.all([
    getVenueIndex(),
    dropIds.length ? pintDropsStore().listForModerationByIds(dropIds) : Promise.resolve([]),
  ]);
  const dropById = new Map(drops.map((drop) => [drop.id, drop]));
  return Promise.all(checks.map(async (check) => {
    const hit = check.pintDropId ? dropById.get(check.pintDropId) : undefined;
    let receiptPhotoUrl = hit?.receiptPhotoUrl ?? null;
    if (!check.pintDropId && check.roundSource) {
      const spend = await roundsStore().getSpendById(check.roundSource.spendId);
      const item = spend?.items[check.roundSource.lineIndex];
      if (spend && spend.venueId === check.venueId && item?.pricePence === Math.round(check.priceGbp * 100)) {
        receiptPhotoUrl = await resolveStorageUrl(spend.receiptPhotoKey, true);
      }
    }
    return {
      id: check.id,
      venueId: check.venueId,
      venueName: index.get(check.venueId)?.name ?? check.venueId,
      priceGbp: check.priceGbp,
      result: check.result,
      lines: check.lines,
      checkedAt: check.checkedAt,
      receiptPhotoUrl,
      ...(check.pintDropId ? { pintDropId: check.pintDropId } : {}),
      ...(check.communityPriceId ? { communityPriceId: check.communityPriceId } : {}),
      ...(hit
        ? {
            drop: {
              id: hit.id,
              handle: hit.handle,
              drink: hit.drink,
              ...(statedDrinkMeasure(hit.measure)
                ? { serving: drinkMeasureName(hit.measure, hit.measureLabel) }
                : {}),
              status: hit.status,
              createdAt: hit.createdAt,
            },
          }
        : {}),
    };
  }));
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-bill-checks:${ipKey}`, `admin-bill-checks:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  try {
    const checks = await billCheckStore().listMismatchesForReview();
    return jsonNoStore({ checks: await withContext(checks) }, { status: 200 });
  } catch (error) {
    log("error", "bill_checks.list_failed", {
      route: "GET /api/admin/bill-checks",
      error: error instanceof Error ? error.message : String(error),
    });
    return publicApiError("Could not load bill checks.", "UNAVAILABLE", 503, { retryable: true });
  }
}

/** Hide every price a check names, through each lane's own door. False when one did not land. */
async function hidePricesOf(check: BillCheckRecord, note: string): Promise<boolean> {
  if (check.pintDropId) {
    const hidden = await pintDropsStore().moderate(check.pintDropId, "hidden", note);
    if (!hidden) return false;
  }
  if (check.communityPriceId) {
    const result = await moderateCommunityPriceWithState(check.communityPriceId, true, note, { submittedAt: check.communityPriceSubmittedAt!, priceGbp: check.priceGbp, ...(check.roundSource ? { roundSource: check.roundSource } : {}) });
    if (result.status !== "ok" || result.kind === undefined) return false;
    if (result.kind === "price") {
      const trust = await syncTrustAfterPriceHidden(check.communityPriceId);
      if (trust.status === "unavailable") return false;
    }
  }
  return true;
}

export async function POST(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  const ipKey = hashIp(clientIp(request));
  const writeKey = `admin-bill-checks-write:${ipKey}`;
  if (await isLimited(writeKey, writeKey, MODERATION_WRITE_LIMIT)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const id = readString(body.id);
  if (!id) return publicApiError("Missing bill check id.", "INVALID_REQUEST", 400);
  const decision = body.decision;
  if (!isBillCheckReviewDecision(decision)) {
    return publicApiError("Unknown decision.", "INVALID_REQUEST", 400);
  }

  try {
    const store = billCheckStore();
    const check = await store.review(id, decision);
    if (!check) return publicApiError("Bill check not found.", "NOT_FOUND", 404);

    if (decision === "hidden") {
      const note = readString(body.note) || HIDDEN_NOTE;
      let hidden = false;
      try {
        hidden = await hidePricesOf(check, note);
      } finally {
        if (!hidden) await store.releaseReview(check);
      }
      if (!hidden) return unavailable();
    }
    return jsonNoStore({ ok: true, check }, { status: 200 });
  } catch (error) {
    log("error", "bill_checks.review_failed", {
      route: "POST /api/admin/bill-checks",
      decision,
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailable();
  }
}
