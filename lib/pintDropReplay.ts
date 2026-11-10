import { cleanDrinkMeasure } from "@/lib/drinkMeasure";
import { normalizeViewerHandle, visibilityOf, type PintDrop } from "@/lib/pintDrops";
import type { PersistableDrop, PintDropPhotos } from "@/lib/pintDropsStore";

/**
 * The daily cap, refused by the DATABASE rather than by the pre-check in front
 * of it (migration 0141, pentest F-1). A concurrent burst is exactly the case
 * the pre-check cannot see: every request reads "no price yet" before any row
 * lands. `pint_drops_priced_day_unique_idx` is what actually holds the rule, so
 * one of those inserts wins and the rest arrive here.
 *
 * It is a REFUSAL, not a fault: the route answers it with the same 409 and the
 * same sentence the pre-check gives, so a drinker cannot tell which enforcer
 * turned them away.
 */
export class PintDropDailyCapError extends Error {
  readonly code = "PINT_DROP_DAILY_PRICE_CAP";
  constructor() {
    super("A priced Pint Drop for this venue, handle and London day already exists.");
    this.name = "PintDropDailyCapError";
  }
}

export function sameCreatedDrop(existing: PersistableDrop, input: PintDrop, photos: PintDropPhotos): boolean {
  return existing.id === input.id && existing.venueId === input.venueId &&
    existing.authorityKey === input.authorityKey &&
    (Boolean(input.authorityKey) || normalizeViewerHandle(existing.handle) === normalizeViewerHandle(input.handle)) &&
    Boolean(existing.pintPhotoKey) === Boolean(photos.pint) &&
    Boolean(existing.venuePhotoKey) === Boolean(photos.venue) &&
    Boolean(existing.receiptPhotoKey) === Boolean(photos.receipt) &&
    existing.priceGbp === input.priceGbp &&
    existing.drink === input.drink &&
    cleanDrinkMeasure(existing.measure) === cleanDrinkMeasure(input.measure) &&
    (existing.measureLabel ?? "") === (input.measureLabel ?? "") &&
    existing.passedDownNote === input.passedDownNote &&
    existing.era === input.era &&
    visibilityOf(existing) === visibilityOf(input) &&
    JSON.stringify([...(existing.vibeTags ?? [])].sort()) === JSON.stringify([...(input.vibeTags ?? [])].sort()) &&
    (existing.leaveByIso ? Date.parse(existing.leaveByIso) : null) ===
      (input.leaveByIso ? Date.parse(input.leaveByIso) : null) &&
    (existing.lastTrainDecision ?? null) === (input.lastTrainDecision ?? null);
}

export class PintDropReplayConflictError extends Error {
  constructor() {
    super("Pint Drop id already exists with different details.");
    this.name = "PintDropReplayConflictError";
  }
}

export function replayBeforeCap(
  existing: PersistableDrop | undefined,
  input: PintDrop,
  photos: PintDropPhotos,
  capped = false,
): PersistableDrop | undefined {
  if (existing) {
    if (!sameCreatedDrop(existing, input, photos)) throw new PintDropReplayConflictError();
    return existing;
  }
  if (capped) throw new PintDropDailyCapError();
  return undefined;
}

