import type { NightMomentKind } from "@/lib/nightMemory";

const MOMENT_DRAFT_VERSION = 1 as const;
export const MOMENT_DRAFT_CHANNEL = "pubmaxx:moment-drafts:v1";

export type MomentMediaDraft = {
  id: string;
  type: "image" | "video";
  name: string;
  mimeType: string;
  size: number;
  blob: Blob;
  /** Ephemeral preview URL. Never persisted as an authoritative media URL. */
  objectUrl: string | null;
  width: number | null;
  height: number | null;
  focalX: number;
  focalY: number;
  alt: string;
  /** Set when an edit replaces the bytes under the same id. */
  version?: string;
};

/** The photo's identity as a save confirms it: its id and the bytes it holds. */
export function momentMediaKey(item: Pick<MomentMediaDraft, "id" | "version">): string {
  return item.version ? `${item.id}@${item.version}` : item.id;
}

export type MomentDraftV1 = {
  version: typeof MOMENT_DRAFT_VERSION;
  id: string;
  ownerKey: string;
  serverMemoryId: string | null;
  visibility: "private";
  memoryTitle: string;
  caption: string;
  kind: Exclude<NightMomentKind, "pint_drop">;
  venueId: string;
  occurredAt: string;
  media: MomentMediaDraft[];
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export function createMomentDraft(
  ownerKey: string,
  id = crypto.randomUUID(),
  timestamp = new Date().toISOString(),
): MomentDraftV1 {
  return {
    version: MOMENT_DRAFT_VERSION,
    id,
    ownerKey,
    serverMemoryId: null,
    visibility: "private",
    memoryTitle: "",
    caption: "",
    kind: "photo",
    venueId: "",
    occurredAt: timestamp,
    media: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  };
}

export function selectMomentMedia(
  current: MomentMediaDraft[],
  incoming: MomentMediaDraft[],
): { media: MomentMediaDraft[]; error: string | null } {
  const combined = [...current, ...incoming];
  const videos = combined.filter((item) => item.type === "video");
  const images = combined.filter((item) => item.type === "image");
  if (videos.length > 0 && images.length > 0) {
    return { media: current, error: "Choose one video or up to four photos, not both." };
  }
  if (videos.length > 1) {
    return { media: current, error: "A Moment can contain one video." };
  }
  if (images.length > 4) {
    return { media: current, error: "A Moment can contain up to four photos." };
  }
  return { media: combined, error: null };
}

const DB_NAME = "pubmaxx-moment-drafts";
const STORE_NAME = "drafts";

function fallbackKey(ownerKey: string): string {
  return `pubmaxx:moment-draft:v1:${ownerKey}`;
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "ownerKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Draft storage unavailable."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Draft storage failed."));
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => reject(transaction.error ?? new Error("Draft storage was interrupted."));
  });
}

export async function loadMomentDraft(ownerKey: string): Promise<MomentDraftV1 | null> {
  if (typeof window === "undefined") return null;
  try {
    const value = await withStore<MomentDraftV1 | undefined>("readonly", (store) => store.get(ownerKey));
    return value?.version === MOMENT_DRAFT_VERSION ? value : null;
  } catch {
    try {
      const raw = window.localStorage.getItem(fallbackKey(ownerKey));
      const value = raw ? JSON.parse(raw) as MomentDraftV1 : null;
      return value?.version === MOMENT_DRAFT_VERSION ? value : null;
    } catch {
      return null;
    }
  }
}

export async function saveMomentDraft(draft: MomentDraftV1): Promise<void> {
  if (typeof window === "undefined") return;
  const next = { ...draft, updatedAt: new Date().toISOString() };
  try {
    await withStore<IDBValidKey>("readwrite", (store) => store.put(next));
  } catch {
    const metadataOnly = { ...next, media: [] };
    try { window.localStorage.setItem(fallbackKey(draft.ownerKey), JSON.stringify(metadataOnly)); } catch { /* unavailable storage */ }
  }
}

export async function deleteMomentDraft(ownerKey: string): Promise<void> {
  if (typeof window === "undefined") return;
  try { await withStore<undefined>("readwrite", (store) => store.delete(ownerKey)); } catch { /* fallback below */ }
  try { window.localStorage.removeItem(fallbackKey(ownerKey)); } catch { /* unavailable storage */ }
}

type MomentSubmissionMetadata = {
  kind: Exclude<NightMomentKind, "pint_drop">;
  venueId: string | null;
  occurredAt: string;
};

export function momentSubmissionMetadata(
  draft: Pick<MomentDraftV1, "kind" | "venueId" | "occurredAt">,
  hasMedia: boolean,
): MomentSubmissionMetadata {
  return {
    kind: hasMedia ? "photo" : draft.kind === "photo" ? "side_quest" : draft.kind,
    venueId: draft.venueId || null,
    occurredAt: draft.occurredAt,
  };
}

/**
 * What the server confirmed for one draft: the photos it stored, the caption it
 * stored with them and the Memory they went into. A request whose answer never
 * arrived adds nothing, because its commit is unknown.
 */
export type MomentSaveReceipt = {
  uploadedMedia: Array<MomentSubmissionMetadata & { key: string; altText: string }>;
  sentCaption: (MomentSubmissionMetadata & { text: string }) | null;
  sentTitle: string | null;
  serverMemoryId: string | null;
};

function sameMomentSubmissionMetadata(left: MomentSubmissionMetadata, right: MomentSubmissionMetadata): boolean {
  return left.kind === right.kind && left.venueId === right.venueId && left.occurredAt === right.occurredAt;
}

/**
 * The draft with a receipt applied: confirmed photos and a caption the server
 * already holds removed, the Memory kept. Every other edit stays. Null when
 * nothing is left to save.
 */
export function applyMomentSaveReceipt(
  draft: MomentDraftV1,
  receipt: MomentSaveReceipt,
): MomentDraftV1 | null {
  const photoMetadata = momentSubmissionMetadata(draft, true);
  const media = draft.media.filter((item) => !receipt.uploadedMedia.some((sent) =>
    sent.key === momentMediaKey(item) && sent.altText === (item.alt ?? "") && sameMomentSubmissionMetadata(sent, photoMetadata),
  ));
  const sentCaption = receipt.sentCaption;
  const caption = sentCaption !== null && draft.caption === sentCaption.text &&
    sameMomentSubmissionMetadata(sentCaption, momentSubmissionMetadata(draft, sentCaption.kind === "photo"))
    ? "" : draft.caption;
  const savedSomething = receipt.uploadedMedia.length > 0 || sentCaption !== null;
  const newerTitle = receipt.sentTitle !== null && (draft.memoryTitle.trim() || "Tonight's Memory") !== receipt.sentTitle;
  if (savedSomething && media.length === 0 && !caption.trim() && !newerTitle) return null;
  return { ...draft, media, caption, serverMemoryId: receipt.serverMemoryId };
}

/**
 * Apply a save's receipt to whatever this owner has stored for the same draft,
 * in the lane `loadMomentDraft` reads, in one read-and-write. A purged or
 * replaced draft is left alone, a later edit keeps everything the receipt does
 * not cover, and a draft with nothing left is removed. Never rejects.
 */
export async function settleMomentDraftProgress(
  ownerKey: string,
  draftId: string,
  receipt: MomentSaveReceipt,
): Promise<void> {
  if (typeof window === "undefined") return;
  let db: IDBDatabase;
  try {
    db = await openDraftDb();
  } catch {
    settleFallbackDraft(ownerKey, draftId, receipt);
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const read = store.get(ownerKey);
      read.onsuccess = () => {
        const stored = read.result as MomentDraftV1 | undefined;
        if (stored?.id !== draftId) return;
        const next = applyMomentSaveReceipt(stored, receipt);
        if (next) store.put({ ...next, updatedAt: new Date().toISOString() });
        else store.delete(ownerKey);
      };
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); resolve(); };
    } catch {
      db.close();
      resolve();
    }
  });
}

function settleFallbackDraft(ownerKey: string, draftId: string, receipt: MomentSaveReceipt): void {
  try {
    const raw = window.localStorage.getItem(fallbackKey(ownerKey));
    const stored = raw ? JSON.parse(raw) as MomentDraftV1 : null;
    if (stored?.id !== draftId) return;
    const next = applyMomentSaveReceipt(stored, receipt);
    if (next) window.localStorage.setItem(fallbackKey(ownerKey), JSON.stringify({ ...next, media: [], updatedAt: new Date().toISOString() }));
    else window.localStorage.removeItem(fallbackKey(ownerKey));
  } catch {
    // Unavailable storage holds no draft to settle.
  }
}
