import "server-only";

import { randomUUID } from "node:crypto";

import { submitCategoryLabel } from "@/lib/communityPrice";
import { moderateCommunityPrice } from "@/lib/communityPriceStore";
import type { DrinkCategory } from "@/lib/drinks";
import { log } from "@/lib/log";
import {
  cleanDrinkMeasure,
  cleanDrinkMeasureLabel,
  type DrinkMeasure,
} from "@/lib/drinkMeasure";
import type { PintDrop } from "@/lib/pintDrops";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import { pintDropsStore, type PintDropPhotos } from "@/lib/pintDropsStore";
import { profileStore } from "@/lib/profileStore";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";
import { reconcilePriceTrustForObservation } from "@/lib/priceTrustImpact.server";

export type OneTapPintDropInput = Readonly<{
  venueId: string;
  handle: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  /**
   * WHAT SERVING THE FIGURE IS ABOUT, as the DRINKER answered it (review
   * finding F-2). Required, and deliberately not optional: an optional field
   * here is the same assertion this defect was made of, one default away.
   */
  measure: DrinkMeasure;
  /** The free label an `other` measure carries. Empty for pint and half. */
  measureLabel?: string;
  verifiedAccountId?: string;
}>;

/**
 * The venue's recent rows for the duplicate check, or null when the read could
 * not be run. Null is "we could not look", never "nothing there": the caller
 * writes on a null rather than refusing a price it cannot prove is a repeat.
 */
async function listRecentForDedupe(
  store: ReturnType<typeof pintDropsStore>,
  venueId: string,
): Promise<PintDrop[] | null> {
  try {
    return await store.listConfirmationCandidates(venueId);
  } catch (err) {
    log("warn", "one_tap_pint_drop.dedupe_read_failed", {
      venueId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export type OneTapPintDropOutcome =
  | { ok: true; drop: PintDrop }
  | { ok: false; kind: "invalid_photo"; message: string }
  | { ok: false; kind: "storage"; message: string };

/**
 * How long two identical priced drops from one account at one pub are read as
 * ONE tap rather than two reports (battle test D10).
 *
 * Three `el.click()` calls on Log it in one tick sent three POSTs, all 201, and
 * wrote three `pint_drops` rows 21 ms apart; a human double-tap on a slow
 * network does the same, and so does any retry of a request whose response was
 * lost. The client latch below is the first line, but a latch lives in one
 * browser tab and cannot speak for a retry, so the write path needs its own
 * answer.
 *
 * It is deliberately NOT the daily cap. `POST /api/price-submit` pairs a drop
 * with every community price and takes several from one account at one pub in
 * one day ON PURPOSE (AGENTS.md), so a day-wide guard would refuse the second
 * honest correction of an evening. Six seconds refuses a duplicate tap and a
 * lost-response retry, and refuses nothing a drinker meant twice.
 */
export const ONE_TAP_DUPLICATE_WINDOW_MS = 6_000;

/**
 * The row an identical earlier tap already wrote, or null. Pure, so the window
 * rule is testable without a store.
 *
 * Identity is the whole observation: same pub, same account, same figure, same
 * measure. A different figure is a correction and is welcome; a different
 * measure is a different drink. Only an exact repeat inside the window is the
 * same tap arriving twice.
 */
export function duplicateOneTapDrop(
  rows: readonly PintDrop[],
  candidate: Pick<PintDrop, "venueId" | "handle" | "priceGbp" | "measure">,
  now: number,
): PintDrop | null {
  const handle = normalizeViewerHandle(candidate.handle);
  if (!handle || typeof candidate.priceGbp !== "number") return null;
  const measure = cleanDrinkMeasure(candidate.measure);
  let best: PintDrop | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.venueId !== candidate.venueId) continue;
    if (normalizeViewerHandle(row.handle) !== handle) continue;
    if (row.priceGbp !== candidate.priceGbp) continue;
    if (cleanDrinkMeasure(row.measure) !== measure) continue;
    const at = Date.parse(row.createdAt);
    if (!Number.isFinite(at)) continue;
    // A row dated ahead of us is a clock we cannot reason about, not a repeat.
    if (at > now || now - at > ONE_TAP_DUPLICATE_WINDOW_MS) continue;
    if (at <= bestAt) continue;
    best = row;
    bestAt = at;
  }
  return best;
}

async function ensureProfileForHandle(handle: string): Promise<void> {
  try {
    await profileStore().ensure(handle);
  } catch (err) {
    console.warn(
      "[one-tap-pint-drop] could not ensure profile for handle (drop still saved):",
      err instanceof Error ? err.message : err,
    );
  }
}

function buildDrop(input: OneTapPintDropInput): PintDrop {
  const handle = normalizeViewerHandle(input.handle);
  if (!handle) {
    throw new Error("Add a contributor handle.");
  }
  // A label beside `pint` or `half` would be a second name for a measure that
  // already names itself, which the table's own CHECK refuses (migration 0147).
  const measureLabel =
    cleanDrinkMeasure(input.measure) === "other"
      ? cleanDrinkMeasureLabel(input.measureLabel)
      : "";
  return {
    id: randomUUID(),
    venueId: input.venueId,
    handle,
    drink: submitCategoryLabel(input.drinkCategory),
    // THE DRINKER'S OWN ANSWER, carried through (review finding F-2).
    //
    // This line used to state `"pint"`, on the reasoning that the community
    // price composer carries a closed category and no drink text, so its beer
    // chip means a pint. #1517 then made that composer the ONE primary price
    // door on a pub's Overview, and it still never asked: a drinker holding a
    // half tapped Beer, typed 2.60, and got a row stamped `pint` with a real
    // authority key that a second reporter could confirm into pin colour, the
    // cheapest buckets and the Pint Index. The door asks now
    // (components/map/composer/MeasureChips.tsx), and this row says what was
    // answered rather than what was assumed.
    measure: cleanDrinkMeasure(input.measure),
    ...(measureLabel ? { measureLabel } : {}),
    priceGbp: input.priceGbp,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date().toISOString(),
    authorityKey: pintDropAuthorityKey(input.venueId, input.verifiedAccountId),
  };
}

export async function revertOneTapCommunityPricePairing(
  priceId: string | undefined,
): Promise<boolean> {
  if (!priceId) return true;
  const note = "one-tap pairing failed";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (await moderateCommunityPrice(priceId, true, note)) {
        const trust = await reconcilePriceTrustForObservation(priceId);
        return trust.status === "synced";
      }
    } catch (err) {
      log("warn", "one_tap_pint_drop.price_pairing_revert_failed", {
        priceId,
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  log("warn", "one_tap_pint_drop.price_pairing_revert_failed", {
    priceId,
    error: "hide did not land",
  });
  return false;
}

/**
 * The Pint Drop half of a one-tap price submission from the venue sheet.
 *
 * On a PINT the caller writes the community price first and this lands the
 * paired row. On any other measure there is no community price to pair with:
 * that lane carries no measure column, so the route sends the figure here
 * alone and the pint reads hold it out by measure (review finding F-2).
 */
export async function writeOneTapPintDrop(
  input: OneTapPintDropInput,
  photos: PintDropPhotos = { pint: null, venue: null, receipt: null },
): Promise<OneTapPintDropOutcome> {
  // Pint Drops feed pint-only surfaces (pin colour, cheapest-pint buckets,
  // the Confirmed standing, the Pint Index). A non-beer price paired in here
  // would hand those surfaces a coffee or wine figure with pint authority.
  if (input.drinkCategory !== "beer") {
    throw new Error("writeOneTapPintDrop only pairs beer submissions.");
  }
  const handle = normalizeViewerHandle(input.handle);
  if (!handle) {
    return {
      ok: false,
      kind: "storage",
      message: "Could not save your pint drop right now.",
    };
  }

  try {
    const store = pintDropsStore();
    const built = buildDrop(input);
    // IDEMPOTENT ON A SHORT WINDOW. A duplicate tap is answered with the row the
    // first one wrote, so the caller sees the success it already earned and the
    // pub's sheet does not list the same pint three times. A read we could not
    // run writes the drop rather than refusing it: losing a drinker's price to
    // protect against a duplicate is the worse of the two failures.
    const recent = await listRecentForDedupe(store, input.venueId);
    const duplicate = recent
      ? duplicateOneTapDrop(recent, built, Date.parse(built.createdAt))
      : null;
    if (duplicate) {
      log("info", "one_tap_pint_drop.duplicate_tap", { venueId: input.venueId });
      return { ok: true, drop: duplicate };
    }
    const drop = await store.create(built, photos);
    void ensureProfileForHandle(handle);
    return { ok: true, drop };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Photo must")) {
      return { ok: false, kind: "invalid_photo", message: err.message };
    }
    log("error", "one_tap_pint_drop.create_failed", {
      venueId: input.venueId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      kind: "storage",
      message: "Could not save your pint drop right now.",
    };
  }
}
