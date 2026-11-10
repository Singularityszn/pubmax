import { statedDrinkMeasure, type DrinkMeasure } from "@/lib/drinkMeasure";
import type { PintDropDTO } from "@/lib/feed";
import type { Visibility } from "@/lib/spill";
import type { LastPintDecisionKind } from "@/lib/tfl";
import { venueMapUrl } from "@/lib/venueMapUrl";

export const OPTIMISTIC_SPILL_STORAGE_KEY = "pubmax:optimistic-spill-posts:v1";
export const OPTIMISTIC_SPILL_EVENT = "pubmax:optimistic-spill-posts-changed";

export type StoredOptimisticSpill = {
  clientRequestId: string;
  drop: PintDropDTO;
  retry?: OptimisticSpillRetryPayload;
};

export type OptimisticSpillInput = {
  clientRequestId: string;
  venueId: string;
  venueName?: string;
  handle: string;
  priceGbp: string;
  drink: string;
  passedDownNote: string;
  era: string;
  visibility: Visibility;
  vibeTags: string[];
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  createdAt: string;
  /** Wave G1: optional Last Train context when a live decision was on screen. */
  leaveByIso?: string;
  lastTrainDecision?: LastPintDecisionKind;
  /**
   * The "With" handles this drop proposes once it has an id. They are never
   * part of the note, so a retry that forgot them lost the tags.
   */
  withHandles?: string[];
};

/** A retry posts exactly what the drinker submitted, so it needs these too. */
export type OptimisticSpillRetryInput = OptimisticSpillInput & {
  receiptPhotoUrl: string | null;
  measure: DrinkMeasure;
  measureLabel: string;
};

export type OptimisticSpillRetryPayload = {
  /**
   * The first attempt's key, resent so the server answers a retry of a drop
   * it already saved. Absent on entries stored before retries carried it.
   */
  clientRequestId?: string;
  venueId: string;
  venueName?: string;
  handle: string;
  priceGbp: string;
  drink: string;
  passedDownNote: string;
  era: string;
  visibility: Visibility;
  vibeTags: string[];
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  receiptPhotoUrl: string | null;
  measure: DrinkMeasure;
  measureLabel: string;
  /**
   * True when a photo was attached but its local preview could not be kept:
   * a `blob:` URL is never written to storage (it dies with the document), so
   * the persisted payload says a photo is missing rather than retrying
   * without it.
   */
  photoNotKept?: true;
  leaveByIso?: string;
  lastTrainDecision?: LastPintDecisionKind;
  /** The "With" handles, sent as tag proposals after the retry saves. */
  withHandles?: string[];
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const liveRetries = new WeakMap<StorageLike, Map<string, OptimisticSpillRetryPayload>>();
const livePhotoPreviews = new Map<string, Blob>();

export function createOptimisticSpillPhotoPreview(photo: Blob): string {
  const url = URL.createObjectURL(photo);
  livePhotoPreviews.set(url, photo);
  return url;
}

export function revokeOptimisticSpillPhotoPreview(url: string): void {
  livePhotoPreviews.delete(url);
  URL.revokeObjectURL(url);
}

function parsePrice(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function cleanString(value: string): string {
  return value.replace(/[<>]/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

export function newOptimisticSpillClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function shouldOptimisticallyAppearInFeed(visibility: Visibility): boolean {
  return visibility === "public" || visibility === "anonymous";
}

export function buildOptimisticSpillDrop(input: OptimisticSpillInput): PintDropDTO {
  const priceGbp = parsePrice(input.priceGbp);
  const hasPhoto = Boolean(input.pintPhotoUrl || input.venuePhotoUrl);
  const handle =
    input.visibility === "anonymous" ? "a PUBMAXXER" : cleanString(input.handle) || "PUBMAXXER";

  return {
    id: `optimistic-${input.clientRequestId}`,
    handle,
    priceGbp,
    drink: cleanString(input.drink),
    passedDownNote: cleanString(input.passedDownNote),
    era: cleanString(input.era),
    provenance: priceGbp === null ? "anecdote" : "contributor",
    venueId: input.venueId,
    createdAt: input.createdAt,
    vibeTags: input.vibeTags,
    pintPhotoUrl: input.pintPhotoUrl,
    venuePhotoUrl: input.venuePhotoUrl,
    venueName: cleanString(input.venueName ?? "") || undefined,
    venueMapUrl: venueMapUrl(input.venueId),
    ...(input.leaveByIso ? { leaveByIso: input.leaveByIso } : {}),
    ...(input.lastTrainDecision ? { lastTrainDecision: input.lastTrainDecision } : {}),
    optimistic: {
      state: hasPhoto ? "uploading" : "pending",
      message: hasPhoto ? "Posting Spill, uploading photo" : "Posting Spill",
      uploadProgress: hasPhoto ? 0 : null,
      canRetry: false,
      clientRequestId: input.clientRequestId,
    },
  };
}

export function buildOptimisticSpillRetryPayload(
  input: OptimisticSpillRetryInput,
): OptimisticSpillRetryPayload {
  return {
    clientRequestId: input.clientRequestId,
    venueId: input.venueId,
    venueName: input.venueName,
    handle: input.handle,
    priceGbp: input.priceGbp,
    drink: input.drink,
    passedDownNote: input.passedDownNote,
    era: input.era,
    visibility: input.visibility,
    vibeTags: input.vibeTags,
    pintPhotoUrl: input.pintPhotoUrl,
    venuePhotoUrl: input.venuePhotoUrl,
    receiptPhotoUrl: input.receiptPhotoUrl,
    measure: input.measure,
    measureLabel: input.measureLabel,
    ...(input.leaveByIso ? { leaveByIso: input.leaveByIso } : {}),
    ...(input.lastTrainDecision ? { lastTrainDecision: input.lastTrainDecision } : {}),
    ...(input.withHandles && input.withHandles.length > 0 ? { withHandles: [...input.withHandles] } : {}),
  };
}

export function upsertOptimisticSpill(
  stored: StoredOptimisticSpill[],
  drop: PintDropDTO,
  retry?: OptimisticSpillRetryPayload,
): StoredOptimisticSpill[] {
  const clientRequestId = drop.optimistic?.clientRequestId;
  if (!clientRequestId) return stored;
  const next = stored.filter((entry) => entry.clientRequestId !== clientRequestId);
  return [{ clientRequestId, drop, ...(retry ? { retry } : {}) }, ...next];
}

export function reconcileOptimisticSpill(
  stored: StoredOptimisticSpill[],
  clientRequestId: string,
  serverDrop: PintDropDTO,
): StoredOptimisticSpill[] {
  const withoutDraft = stored.filter((entry) => entry.clientRequestId !== clientRequestId);
  return [{ clientRequestId, drop: serverDrop }, ...withoutDraft];
}

export function failOptimisticSpill(
  stored: StoredOptimisticSpill[],
  clientRequestId: string,
  message: string,
): StoredOptimisticSpill[] {
  return stored.map((entry) => {
    if (entry.clientRequestId !== clientRequestId) return entry;
    return {
      ...entry,
      drop: {
        ...entry.drop,
        optimistic: {
          state: "failed",
          message,
          uploadProgress: null,
          canRetry: true,
          clientRequestId,
        },
      },
    };
  });
}

export function markOptimisticSpillRetrying(
  stored: StoredOptimisticSpill[],
  clientRequestId: string,
): StoredOptimisticSpill[] {
  return stored.map((entry) => {
    if (entry.clientRequestId !== clientRequestId) return entry;
    const hasPhoto = Boolean(entry.drop.pintPhotoUrl || entry.drop.venuePhotoUrl);
    return {
      ...entry,
      drop: {
        ...entry.drop,
        optimistic: {
          state: hasPhoto ? "uploading" : "pending",
          message: hasPhoto ? "Retrying Spill, uploading photo" : "Retrying Spill",
          uploadProgress: hasPhoto ? 0 : null,
          canRetry: false,
          clientRequestId,
        },
      },
    };
  });
}

const PHOTO_PREVIEW_GONE =
  "Photo preview is no longer available. Open the composer and attach it again.";
export const RETRY_DETAILS_GONE =
  "Retry details are no longer available. Open the map and post it again.";

function appendRetryPhoto(
  body: FormData,
  field: "pint_photo" | "venue_photo" | "receipt_photo",
  url: string | null,
) {
  if (!url) return;
  if (!url.startsWith("blob:")) return;
  // CSP allows blob images but not blob fetches. Keep the original bytes
  // only while the composer still owns the preview.
  const blob = livePhotoPreviews.get(url);
  if (!blob) throw new Error(PHOTO_PREVIEW_GONE);
  const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  body.set(field, blob, `${field}.${extension}`);
}

export async function buildOptimisticSpillRetryFormData(
  payload: OptimisticSpillRetryPayload,
): Promise<FormData> {
  // A photo the drinker attached is never silently dropped from a retry.
  if (payload.photoNotKept) throw new Error(PHOTO_PREVIEW_GONE);
  // The server reads a missing measure as a pint, so an entry stored before
  // the measure was kept cannot be retried honestly.
  const measure = statedDrinkMeasure(payload.measure);
  if (!measure) throw new Error(RETRY_DETAILS_GONE);
  const body = new FormData();
  if (payload.clientRequestId) body.set("clientRequestId", payload.clientRequestId);
  body.set("venueId", payload.venueId);
  body.set("handle", payload.handle);
  body.set("drink", payload.drink);
  body.set("measure", measure);
  body.set("measureLabel", measure === "other" ? (payload.measureLabel ?? "") : "");
  body.set("priceGbp", payload.priceGbp);
  body.set("passedDownNote", payload.passedDownNote);
  body.set("era", payload.era);
  body.set("visibility", payload.visibility);
  for (const tag of payload.vibeTags) body.append("vibe_tags", tag);
  if (payload.leaveByIso) body.set("leaveByIso", payload.leaveByIso);
  if (payload.lastTrainDecision) body.set("lastTrainDecision", payload.lastTrainDecision);
  appendRetryPhoto(body, "pint_photo", payload.pintPhotoUrl);
  appendRetryPhoto(body, "venue_photo", payload.venuePhotoUrl);
  appendRetryPhoto(body, "receipt_photo", payload.receiptPhotoUrl);
  return body;
}

export function mergeOptimisticSpillDrops(
  serverDrops: PintDropDTO[],
  stored: StoredOptimisticSpill[],
): PintDropDTO[] {
  const localDrops = stored.map((entry) => entry.drop);
  const localIds = new Set(localDrops.map((drop) => drop.id));
  const localClientIds = new Set(
    localDrops.map((drop) => drop.optimistic?.clientRequestId).filter(Boolean),
  );
  return [
    ...localDrops,
    ...serverDrops.filter(
      (drop) => !localIds.has(drop.id) && !localClientIds.has(drop.optimistic?.clientRequestId),
    ),
  ];
}

function isStoredOptimisticSpill(value: unknown): value is StoredOptimisticSpill {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<StoredOptimisticSpill>;
  return (
    typeof entry.clientRequestId === "string" &&
    Boolean(entry.clientRequestId) &&
    typeof entry.drop === "object" &&
    entry.drop !== null &&
    typeof (entry.drop as Partial<PintDropDTO>).id === "string"
  );
}

// Blob URLs and photo bytes stay out of localStorage because previews expire
// on reload or release. Reads strip persisted previews before restoring retry
// metadata from this document's in-memory payload. Display rows stay stripped.
function isBlobUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("blob:");
}

function withoutBlobPreviews(entry: StoredOptimisticSpill): StoredOptimisticSpill {
  const drop = { ...entry.drop } as PintDropDTO & { receiptPhotoUrl?: string | null };
  if (isBlobUrl(drop.pintPhotoUrl)) drop.pintPhotoUrl = null;
  if (isBlobUrl(drop.venuePhotoUrl)) drop.venuePhotoUrl = null;
  if (isBlobUrl(drop.receiptPhotoUrl)) drop.receiptPhotoUrl = null;
  if (!entry.retry) return { ...entry, drop };
  const retry = { ...entry.retry };
  if (isBlobUrl(retry.pintPhotoUrl)) {
    retry.pintPhotoUrl = null;
    retry.photoNotKept = true;
  }
  if (isBlobUrl(retry.venuePhotoUrl)) {
    retry.venuePhotoUrl = null;
    retry.photoNotKept = true;
  }
  if (isBlobUrl(retry.receiptPhotoUrl)) {
    retry.receiptPhotoUrl = null;
    retry.photoNotKept = true;
  }
  return { ...entry, drop, retry };
}

export function readOptimisticSpills(storage: StorageLike): StoredOptimisticSpill[] {
  try {
    const raw = storage.getItem(OPTIMISTIC_SPILL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isStoredOptimisticSpill).map((entry) => {
          const stored = withoutBlobPreviews(entry);
          const retry = liveRetries.get(storage)?.get(entry.clientRequestId);
          return stored.retry && retry ? { ...stored, retry: { ...retry } } : stored;
        })
      : [];
  } catch {
    return [];
  }
}

export function writeOptimisticSpills(
  storage: StorageLike,
  entries: StoredOptimisticSpill[],
): void {
  const retained = entries.slice(0, 10);
  const retries = new Map<string, OptimisticSpillRetryPayload>();
  for (const entry of retained) {
    if (entry.retry) retries.set(entry.clientRequestId, { ...entry.retry });
  }
  liveRetries.set(storage, retries);
  try {
    if (entries.length === 0) {
      storage.removeItem(OPTIMISTIC_SPILL_STORAGE_KEY);
      return;
    }
    storage.setItem(OPTIMISTIC_SPILL_STORAGE_KEY, JSON.stringify(retained.map(withoutBlobPreviews)));
  } catch {
    // Storage can be full or disabled; the in-memory submit path still proceeds.
  }
}

export function emitOptimisticSpillChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPTIMISTIC_SPILL_EVENT));
}
