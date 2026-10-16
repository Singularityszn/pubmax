import "server-only";

import { randomUUID } from "node:crypto";

import {
  COMMUNITY_PRICE_MAX_GBP,
  COMMUNITY_PRICE_MIN_GBP,
  submitCategoryLabel,
  type CommunityPrice,
} from "@/lib/communityPrice";
import {
  captureMemoryCommunityPricePairingRollback,
  commitMemoryCommunityPricePairing,
  moderateCommunityPrice,
  resetCommunityPriceCategoryIndexMemo,
  submitMemoryCommunityPriceSync,
} from "@/lib/communityPriceStore";
import type { DrinkCategory } from "@/lib/drinks";
import { log } from "@/lib/log";
import type { PintDrop } from "@/lib/pintDrops";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import {
  deletePhotos,
  memoryPintDropPairWriter,
  pintDropsStore,
  toDTO,
  toDTOWithPhotos,
  uploadPhoto,
  type PersistableDrop,
  type PintDropPhotos,
} from "@/lib/pintDropsStore";
import { profileStore } from "@/lib/profileStore";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";
import { reconcilePriceTrustForObservation } from "@/lib/priceTrustImpact.server";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

export type OneTapPintDropInput = Readonly<{
  venueId: string;
  handle: string;
  drinkCategory: DrinkCategory;
  priceGbp: number;
  verifiedAccountId?: string;
}>;

export type OneTapPintDropOutcome =
  | { ok: true; drop: PintDrop }
  | { ok: false; kind: "invalid_photo"; message: string }
  | { ok: false; kind: "storage"; message: string };

export type OneTapPricePairInput = OneTapPintDropInput & Readonly<{
  actor: string;
}>;

export type OneTapPricePairOutcome =
  | { ok: true; price: CommunityPrice; drop: PintDrop }
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
 * The Pint Drop half of a one-tap price submission from the venue sheet. Community
 * price is written first by the caller; this lane lands the paired row in
 * pint_drops through the existing Pint Drop store.
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
    const drop = await pintDropsStore().create(buildDrop(input), photos);
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

function storageFailure(): OneTapPricePairOutcome {
  return {
    ok: false,
    kind: "storage",
    message: "Could not save your pint drop right now.",
  };
}

function writeMemoryOneTapPricePair(
  input: OneTapPricePairInput,
  drop: PintDrop,
): OneTapPricePairOutcome {
  const submittedAt = Date.parse(drop.createdAt);
  const pricePennies = Math.round(input.priceGbp * 100);
  const write = {
    venueId: input.venueId,
    drinkCategory: input.drinkCategory,
    priceGbp: input.priceGbp,
    actor: input.actor,
    contributorHandle: input.handle,
  };
  const rollbackPrice = captureMemoryCommunityPricePairingRollback(write);
  const { price, failed } = submitMemoryCommunityPriceSync(
    write,
    submittedAt,
    { deferEviction: true },
  );
  if (failed || !price) return storageFailure();
  if (
    price.submittedAt !== submittedAt ||
    Math.round(price.priceGbp * 100) !== pricePennies
  ) {
    return storageFailure();
  }

  try {
    const pairedDrop = memoryPintDropPairWriter.create({
      ...drop,
      priceGbp: price.priceGbp,
    });
    commitMemoryCommunityPricePairing();
    void ensureProfileForHandle(input.handle);
    return { ok: true, price, drop: pairedDrop };
  } catch (error) {
    rollbackPrice(price);
    log("error", "one_tap_pint_drop.memory_pair_create_failed", {
      venueId: input.venueId,
      error: error instanceof Error ? error.message : String(error),
    });
    return storageFailure();
  }
}

type DurablePairReceipt = Readonly<{
  priceId: string;
  pricePennies: number;
  submittedAt: number;
}>;

function readDurablePairReceipt(
  data: unknown,
  input: OneTapPricePairInput,
  drop: PintDrop,
): DurablePairReceipt | null {
  const row = Array.isArray(data) && data.length === 1 && data[0] && typeof data[0] === "object"
    ? data[0] as Record<string, unknown>
    : null;
  const submittedAt = typeof row?.submitted_at === "string"
    ? Date.parse(row.submitted_at)
    : Number.NaN;
  const pricePennies = row?.price_pennies;
  const expectedSubmittedAt = Date.parse(drop.createdAt);
  const expectedPricePennies = Math.round(input.priceGbp * 100);
  if (
    !row ||
    typeof row.price_id !== "string" ||
    row.price_id.length === 0 ||
    typeof pricePennies !== "number" ||
    !Number.isInteger(pricePennies) ||
    pricePennies < COMMUNITY_PRICE_MIN_GBP * 100 ||
    pricePennies > COMMUNITY_PRICE_MAX_GBP * 100 ||
    !Number.isFinite(submittedAt) ||
    submittedAt !== expectedSubmittedAt ||
    pricePennies !== expectedPricePennies ||
    row.drop_id !== drop.id
  ) {
    return null;
  }
  return {
    priceId: row.price_id,
    pricePennies,
    submittedAt,
  };
}

type DurablePairRecovery =
  | { state: "committed"; receipt: DurablePairReceipt }
  | { state: "absent" }
  | { state: "unknown" };

async function recoverDurableOneTapPricePair(
  input: OneTapPricePairInput,
  drop: PersistableDrop,
): Promise<DurablePairRecovery> {
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "recover_one_tap_price_pair",
      {
        p_actor: input.actor,
        p_authority_key: drop.authorityKey ?? null,
        p_drink_category: input.drinkCategory,
        p_drop_id: drop.id,
        p_pint_photo_key: drop.pintPhotoKey ?? null,
        p_price_pennies: Math.round(input.priceGbp * 100),
        p_submitted_at: drop.createdAt,
        p_venue_id: input.venueId,
        p_venue_photo_key: drop.venuePhotoKey ?? null,
      },
    );
    if (error) return { state: "unknown" };
    if (Array.isArray(data) && data.length === 0) return { state: "absent" };
    const receipt = readDurablePairReceipt(data, input, drop);
    return receipt
      ? { state: "committed", receipt }
      : { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

async function writeDurableOneTapPricePair(
  input: OneTapPricePairInput,
  drop: PintDrop,
  photos: PintDropPhotos,
): Promise<OneTapPricePairOutcome> {
  const persistable: PersistableDrop = { ...drop };
  const uploaded: string[] = [];
  let receipt: DurablePairReceipt | null = null;

  try {
    if (photos.pint) {
      persistable.pintPhotoKey = await uploadPhoto(
        "pint",
        drop.venueId,
        drop.id,
        photos.pint,
      );
      uploaded.push(persistable.pintPhotoKey);
    }
    if (photos.venue) {
      persistable.venuePhotoKey = await uploadPhoto(
        "venue",
        drop.venueId,
        drop.id,
        photos.venue,
      );
      uploaded.push(persistable.venuePhotoKey);
    }
  } catch (error) {
    await deletePhotos(uploaded);
    if (error instanceof Error && error.message.startsWith("Photo must")) {
      return { ok: false, kind: "invalid_photo", message: error.message };
    }
    log("error", "one_tap_pint_drop.photo_upload_failed", {
      venueId: input.venueId,
      error: error instanceof Error ? error.message : String(error),
    });
    return storageFailure();
  }

  let createError: unknown = null;
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "create_one_tap_price_pair",
      {
        p_actor: input.actor,
        p_authority_key: drop.authorityKey ?? null,
        p_contributor_handle: input.handle,
        p_drink: drop.drink,
        p_drink_category: input.drinkCategory,
        p_drop_id: drop.id,
        p_handle: drop.handle,
        p_pint_photo_key: persistable.pintPhotoKey ?? null,
        p_price_pennies: Math.round(input.priceGbp * 100),
        p_submitted_at: drop.createdAt,
        p_venue_id: input.venueId,
        p_venue_photo_key: persistable.venuePhotoKey ?? null,
      },
    );
    if (error) throw new Error(error.message);
    const parsed = readDurablePairReceipt(data, input, drop);
    if (!parsed) throw new Error("Paired price write returned no receipt.");
    receipt = parsed;
  } catch (error) {
    createError = error;
  }

  if (!receipt) {
    const recovery = await recoverDurableOneTapPricePair(input, persistable);
    if (recovery.state === "committed") {
      receipt = recovery.receipt;
    } else {
      if (recovery.state === "absent") await deletePhotos(uploaded);
      log("error", "one_tap_pint_drop.pair_create_failed", {
        venueId: input.venueId,
        recovery: recovery.state,
        error: createError instanceof Error
          ? createError.message
          : String(createError),
      });
      return storageFailure();
    }
  }

  persistable.priceGbp = receipt.pricePennies / 100;
  const price: CommunityPrice = {
    id: receipt.priceId,
    venueId: input.venueId,
    drinkCategory: input.drinkCategory,
    priceGbp: receipt.pricePennies / 100,
    submittedAt: receipt.submittedAt,
    source: "community",
  };
  let publicDrop: PintDrop;
  try {
    publicDrop = await toDTOWithPhotos(persistable);
  } catch (error) {
    log("warn", "one_tap_pint_drop.photo_urls_unavailable", {
      venueId: input.venueId,
      error: error instanceof Error ? error.message : String(error),
    });
    publicDrop = toDTO(persistable);
  }
  void ensureProfileForHandle(input.handle);
  return { ok: true, price, drop: publicDrop };
}

/** Commit one Community Price and its Pint Drop together, or keep neither. */
export async function writeOneTapPricePair(
  input: OneTapPricePairInput,
  photos: PintDropPhotos = { pint: null, venue: null },
): Promise<OneTapPricePairOutcome> {
  let drop: PintDrop;
  try {
    drop = buildDrop(input);
  } catch {
    return storageFailure();
  }

  resetCommunityPriceCategoryIndexMemo();
  try {
    return isSupabaseConfigured()
      ? await writeDurableOneTapPricePair(input, drop, photos)
      : writeMemoryOneTapPricePair(input, drop);
  } finally {
    resetCommunityPriceCategoryIndexMemo();
  }
}
