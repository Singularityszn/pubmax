import "server-only";

import { createHash } from "node:crypto";

import type { PintDrop } from "@/lib/pintDrops";
import type { PintDropPhotos } from "@/lib/pintDropsStore";
import { admin } from "@/lib/storeBackend";

export type PintDropCreateRequest = {
  readonly actorKeyHash: string;
  readonly requestDigest: string;
};

export class PintDropCreateConflictError extends Error {
  constructor() {
    super("This submission key already belongs to a different Pint Drop.");
    this.name = "PintDropCreateConflictError";
  }
}

export class PintDropCommitUncertainError extends Error {
  constructor() {
    super("The Pint Drop commit could not be confirmed.");
    this.name = "PintDropCommitUncertainError";
  }
}

export class PintDropDailyCapError extends Error {
  readonly code = "PINT_DROP_DAILY_PRICE_CAP";
  constructor() {
    super("A priced Pint Drop for this venue, handle and London day already exists.");
    this.name = "PintDropDailyCapError";
  }
}

export function validPintDropCreateKey(value: string): boolean {
  return /^[A-Za-z0-9._:-]{16,128}$/.test(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Bind validated content to the verified account, never the asserted handle. */
export async function pintDropCreateRequest(
  userId: string,
  key: string,
  drop: PintDrop,
  photos: PintDropPhotos,
): Promise<PintDropCreateRequest> {
  const photoHashes = await Promise.all(
    [photos.pint, photos.venue, photos.receipt].map(async (file) =>
      file ? sha256(new Uint8Array(await file.arrayBuffer())) : null,
    ),
  );
  return {
    actorKeyHash: sha256(JSON.stringify(["pint-drop:create:v1", userId, key])),
    requestDigest: sha256(JSON.stringify({
      venueId: drop.venueId,
      drink: drop.drink,
      measure: drop.measure ?? "pint",
      measureLabel: drop.measureLabel ?? null,
      priceGbp: drop.priceGbp,
      passedDownNote: drop.passedDownNote,
      era: drop.era,
      visibility: drop.visibility ?? "public",
      vibeTags: [...(drop.vibeTags ?? [])].sort(),
      leaveByIso: drop.leaveByIso ?? null,
      lastTrainDecision: drop.lastTrainDecision ?? null,
      photoHashes,
    })),
  };
}

/** This private lookup fails closed when migration 0157 is unavailable. */
export async function findStoredPintDropCreation(
  request: PintDropCreateRequest,
): Promise<Record<string, unknown> | null> {
  const { data: prior, error } = await admin().from("pint_drop_create_requests")
    .select("request_digest, drop_id").eq("actor_key_hash", request.actorKeyHash).maybeSingle();
  if (error) throw new Error(error.message);
  if (!prior) return null;
  if (prior.request_digest !== request.requestDigest) throw new PintDropCreateConflictError();
  const { data: drop, error: readError } = await admin().from("pint_drops")
    .select("*").eq("id", prior.drop_id).single();
  if (readError) throw new Error(readError.message);
  if (!drop) throw new Error("The committed Pint Drop could not be read.");
  return drop;
}

/** A failed RPC reply does not prove rollback. Resolve the key before cleanup. */
export async function createStoredPintDrop(
  row: Record<string, unknown>,
  request: PintDropCreateRequest,
): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await admin().rpc("create_pint_drop_idempotent", {
      p_actor_key_hash: request.actorKeyHash,
      p_request_digest: request.requestDigest,
      p_drop: row,
    });
    if (error) throw new Error(error.message);
    if (data?.outcome === "conflict") throw new PintDropCreateConflictError();
    if (data?.outcome === "daily_cap") throw new PintDropDailyCapError();
    if ((data?.outcome === "created" || data?.outcome === "replayed") && data.drop?.id) {
      return data.drop;
    }
    throw new Error("Invalid Pint Drop creation result.");
  } catch (error) {
    if (error instanceof PintDropCreateConflictError || error instanceof PintDropDailyCapError) throw error;
    try {
      const committed = await findStoredPintDropCreation(request);
      if (committed) return committed;
    } catch (readError) {
      if (readError instanceof PintDropCreateConflictError) throw readError;
    }
    // An absent row may still belong to an in-flight transaction. Keep its files.
    throw new PintDropCommitUncertainError();
  }
}
