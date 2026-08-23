import "server-only";

import { randomUUID } from "node:crypto";

import { submitCategoryLabel } from "@/lib/communityPrice";
import { moderateCommunityPrice } from "@/lib/communityPriceStore";
import type { DrinkCategory } from "@/lib/drinks";
import { log } from "@/lib/log";
import type { PintDrop } from "@/lib/pintDrops";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import { pintDropsStore, type PintDropPhotos } from "@/lib/pintDropsStore";
import { profileStore } from "@/lib/profileStore";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";

export type OneTapPintDropInput = Readonly<{
  venueId: string;
  handle: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  verifiedActor?: string;
}>;

export type OneTapPintDropOutcome =
  | { ok: true; skipped: true }
  | { ok: true; skipped: false; drop: PintDrop }
  | { ok: false; kind: "invalid_photo"; message: string }
  | { ok: false; kind: "storage"; message: string };

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
  return {
    id: randomUUID(),
    venueId: input.venueId,
    handle,
    drink: submitCategoryLabel(input.drinkCategory),
    priceGbp: input.priceGbp,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date().toISOString(),
    authorityKey: pintDropAuthorityKey(input.venueId, input.verifiedActor),
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
        return true;
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
 * The visit-report half of a one-tap pint drop from the venue sheet. Community
 * price is written first by the caller; this lane lands the paired row in
 * visit_reports through the existing pint drop store.
 */
export async function writeOneTapPintDrop(
  input: OneTapPintDropInput,
  photos: PintDropPhotos = { pint: null, venue: null },
): Promise<OneTapPintDropOutcome> {
  const handle = normalizeViewerHandle(input.handle);
  if (!handle) {
    return {
      ok: false,
      kind: "storage",
      message: "Could not save your pint drop right now.",
    };
  }

  try {
    if (await pintDropsStore().hasPricedDropToday(input.venueId, handle)) {
      return { ok: true, skipped: true };
    }
  } catch (err) {
    log("warn", "one_tap_pint_drop.dedupe_check_failed", {
      venueId: input.venueId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const drop = await pintDropsStore().create(buildDrop(input), photos);
    void ensureProfileForHandle(handle);
    return { ok: true, skipped: false, drop };
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
