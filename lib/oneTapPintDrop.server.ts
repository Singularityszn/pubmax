import "server-only";

import { randomUUID } from "node:crypto";

import {
  submitCategoryLabel,
  type CommunityPrice,
} from "@/lib/communityPrice";
import {
  captureMemoryCommunityPricePairingRollback,
  submitMemoryCommunityPriceSync,
} from "@/lib/communityPriceStore";
import type { DrinkCategory } from "@/lib/drinks";
import { log } from "@/lib/log";
import type { PintDrop } from "@/lib/pintDrops";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import {
  deletePhotos,
  memoryPintDropPairWriter,
  toDTOWithPhotos,
  uploadPhoto,
  type PersistableDrop,
  type PintDropPhotos,
} from "@/lib/pintDropsStore";
import { profileStore } from "@/lib/profileStore";
import { pintDropAuthorityKey } from "@/lib/pintDropAuthority.server";
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

function writeMemoryOneTapPintDrop(
  input: OneTapPintDropInput,
): OneTapPintDropOutcome {
  const handle = normalizeViewerHandle(input.handle);
  if (!handle) {
    return {
      ok: false,
      kind: "storage",
      message: "Could not save your pint drop right now.",
    };
  }

  try {
    const drop = memoryPintDropPairWriter.create(buildDrop(input));
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

/** Write one Community Price and its Pint Drop without a visible split state. */
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

  if (!isSupabaseConfigured()) {
    const rollbackPrice = captureMemoryCommunityPricePairingRollback(input);
    const { price, failed } = submitMemoryCommunityPriceSync({
      venueId: input.venueId,
      drinkCategory: input.drinkCategory,
      priceGbp: input.priceGbp,
      actor: input.actor,
      contributorHandle: input.handle,
    });
    if (failed || !price) return storageFailure();
    const dropOutcome = writeMemoryOneTapPintDrop({
      ...input,
      priceGbp: price.priceGbp,
    });
    if (!dropOutcome.ok) {
      rollbackPrice(price);
      return dropOutcome;
    }
    return { ok: true, price, drop: dropOutcome.drop };
  }

  const persistable: PersistableDrop = { ...drop };
  const uploaded: string[] = [];
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
    const submittedAt = drop.createdAt;
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
        p_submitted_at: submittedAt,
        p_venue_id: input.venueId,
        p_venue_photo_key: persistable.venuePhotoKey ?? null,
      },
    );
    if (error) throw new Error(error.message);
    const saved = Array.isArray(data) && data[0] && typeof data[0] === "object"
      ? data[0] as Record<string, unknown>
      : null;
    const savedAt = typeof saved?.submitted_at === "string"
      ? Date.parse(saved.submitted_at)
      : Number.NaN;
    const pennies = saved?.price_pennies;
    if (
      !saved
      || typeof saved.price_id !== "string"
      || saved.price_id.length === 0
      || typeof pennies !== "number"
      || !Number.isInteger(pennies)
      || pennies < 0
      || !Number.isFinite(savedAt)
      || saved.drop_id !== drop.id
    ) {
      throw new Error("Paired price write returned no receipt.");
    }
    persistable.priceGbp = pennies / 100;
    const price: CommunityPrice = {
      id: saved.price_id,
      venueId: input.venueId,
      drinkCategory: input.drinkCategory,
      priceGbp: pennies / 100,
      submittedAt: savedAt,
      source: "community",
    };
    void ensureProfileForHandle(input.handle);
    return {
      ok: true,
      price,
      drop: await toDTOWithPhotos(persistable),
    };
  } catch (err) {
    await deletePhotos(uploaded);
    if (err instanceof Error && err.message.startsWith("Photo must")) {
      return { ok: false, kind: "invalid_photo", message: err.message };
    }
    log("error", "one_tap_pint_drop.pair_create_failed", {
      venueId: input.venueId,
      error: err instanceof Error ? err.message : String(err),
    });
    return storageFailure();
  }
}
