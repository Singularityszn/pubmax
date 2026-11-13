import "server-only";

import { randomUUID } from "node:crypto";
import { duplicateOneTapDrop } from "@/lib/oneTapDuplicate";

import { submitCategoryLabel } from "@/lib/communityPrice";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { DrinkCategory } from "@/lib/drinks";
import { log } from "@/lib/log";
import {
  cleanDrinkMeasure,
  cleanDrinkMeasureLabel,
  type DrinkMeasure,
} from "@/lib/drinkMeasure";
import type { PintDrop } from "@/lib/pintDrops";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import {
  PhotoRefusalError,
  OneTapPriceSupersededError,
  pintDropsStore,
  type PintDropPhotos,
} from "@/lib/pintDropsStore";
import { profileStore } from "@/lib/profileStore";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";
import { signalPintDropLanded } from "@/lib/pintDropsBroadcast.server";
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
  | { ok: true; drop: PintDrop; created: boolean; price?: CommunityPrice }
  | { ok: false; kind: "invalid_photo"; message: string }
  | { ok: false; kind: "storage" | "superseded"; message: string };

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

export async function writeOneTapPintDrop(
  input: OneTapPintDropInput,
  photos: PintDropPhotos = { pint: null, venue: null, receipt: null },
  pairing?: { actor: string; submittedAt: number },
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
    if (pairing) built.createdAt = new Date(pairing.submittedAt).toISOString();
    // IDEMPOTENT ON A SHORT WINDOW. A duplicate tap is answered with the row the
    // first one wrote, so the caller sees the success it already earned and the
    // pub's sheet does not list the same pint three times. A read we could not
    // run writes the drop rather than refusing it: losing a drinker's price to
    // protect against a duplicate is the worse of the two failures.
    const recent = !pairing ? await listRecentForDedupe(store, input.venueId) : null;
    const duplicate = !pairing && recent
      ? duplicateOneTapDrop(recent, built, Date.parse(built.createdAt))
      : null;
    if (duplicate) {
      log("info", "one_tap_pint_drop.duplicate_tap", { venueId: input.venueId });
      return { ok: true, drop: duplicate, created: false };
    }
    const { created, communityPrice: price, ...drop } = await store.create(
      built, photos, pairing ? { communityPrice: pairing } : undefined,
    );
    if (created) {
      signalPintDropLanded();
      void ensureProfileForHandle(handle);
    }
    return { ok: true, drop, created, ...(price ? { price } : {}) };
  } catch (err) {
    // The CLASS, not the sentence: an unreadable image is refused with words
    // of its own, and asking about the words sent it down the storage branch
    // as a retryable 503 (lib/pintDropsStore.ts, PhotoRefusalError).
    if (err instanceof OneTapPriceSupersededError) {
      return { ok: false, kind: "superseded", message: "Could not log that price right now." };
    }
    if (err instanceof PhotoRefusalError) {
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
