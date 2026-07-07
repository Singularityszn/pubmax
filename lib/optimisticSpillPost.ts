import type { PintDropDTO } from "@/lib/feed";
import type { Visibility } from "@/lib/spill";

export const OPTIMISTIC_SPILL_STORAGE_KEY = "pubmax:optimistic-spill-posts:v1";
export const OPTIMISTIC_SPILL_EVENT = "pubmax:optimistic-spill-posts-changed";

export type StoredOptimisticSpill = {
  clientRequestId: string;
  drop: PintDropDTO;
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
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function mapUrlFor(venueId: string): string {
  return `/map?sel=${encodeURIComponent(venueId)}`;
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
    venueMapUrl: mapUrlFor(input.venueId),
    optimistic: {
      state: hasPhoto ? "uploading" : "pending",
      message: hasPhoto ? "Posting Spill — uploading photo" : "Posting Spill",
      uploadProgress: hasPhoto ? 0 : null,
      canRetry: false,
      clientRequestId: input.clientRequestId,
    },
  };
}

export function upsertOptimisticSpill(
  stored: StoredOptimisticSpill[],
  drop: PintDropDTO,
): StoredOptimisticSpill[] {
  const clientRequestId = drop.optimistic?.clientRequestId;
  if (!clientRequestId) return stored;
  const next = stored.filter((entry) => entry.clientRequestId !== clientRequestId);
  return [{ clientRequestId, drop }, ...next];
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
      clientRequestId,
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

export function readOptimisticSpills(storage: StorageLike): StoredOptimisticSpill[] {
  try {
    const raw = storage.getItem(OPTIMISTIC_SPILL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isStoredOptimisticSpill) : [];
  } catch {
    return [];
  }
}

export function writeOptimisticSpills(
  storage: StorageLike,
  entries: StoredOptimisticSpill[],
): void {
  try {
    if (entries.length === 0) {
      storage.removeItem(OPTIMISTIC_SPILL_STORAGE_KEY);
      return;
    }
    storage.setItem(OPTIMISTIC_SPILL_STORAGE_KEY, JSON.stringify(entries.slice(0, 10)));
  } catch {
    // Storage can be full or disabled; the in-memory submit path still proceeds.
  }
}

export function emitOptimisticSpillChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPTIMISTIC_SPILL_EVENT));
}
