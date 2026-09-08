import { SOCIAL_GALLERY_MAX_PHOTOS } from "@/lib/socialGallery";

const DATABASE = "pubmaxx-social-gallery-drafts-v1";
const STORE = "photos";

export type SocialGalleryLocalDraftItem = {
  source: "local";
  id: string;
  original: File;
  prepared?: File;
  altText: string;
  uploadKey: string;
  mediaId?: string;
};
export type SocialGalleryRetainedDraftItem = {
  source: "retained";
  id: string;
  mediaId: string;
  altText: string;
};
export type SocialGalleryDraftItem = SocialGalleryLocalDraftItem | SocialGalleryRetainedDraftItem;

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validItem(value: unknown): value is SocialGalleryDraftItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SocialGalleryDraftItem>;
  if (!nonempty(item.id) || typeof item.altText !== "string") return false;
  if (item.source === "retained") return nonempty(item.mediaId) && !("original" in item) && !("prepared" in item);
  return item.source === "local" && item.original instanceof File
    && (item.prepared === undefined || item.prepared instanceof File)
    && nonempty(item.uploadKey)
    && (item.mediaId === undefined || nonempty(item.mediaId));
}

function validPhotos(value: unknown): value is SocialGalleryDraftItem[] {
  return Array.isArray(value) && value.length <= SOCIAL_GALLERY_MAX_PHOTOS
    && value.every(validItem)
    && new Set(value.map((item) => item.id)).size === value.length
    && new Set(value.filter((item) => item.source === "local").map((item) => item.uploadKey)).size
      === value.filter((item) => item.source === "local").length;
}

export function createSocialGalleryDraftItem(original: File, altText = ""): SocialGalleryLocalDraftItem {
  return { source: "local", id: crypto.randomUUID(), original, altText, uploadKey: crypto.randomUUID() };
}

export function removeSocialGalleryDraftItem(items: readonly SocialGalleryDraftItem[], id: string): SocialGalleryDraftItem[] {
  return items.filter((item) => item.id !== id);
}

/** Moves preserve item identity, upload keys, and existing upload receipts. */
export function moveSocialGalleryDraftItem(
  items: readonly SocialGalleryDraftItem[], id: string, toIndex: number,
): SocialGalleryDraftItem[] {
  const next = [...items];
  const fromIndex = next.findIndex((item) => item.id === id);
  if (fromIndex < 0) return next;
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= next.length) {
    throw new RangeError("Choose a photo position within this gallery.");
  }
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Photo drafts are not available in this browser."));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Photo draft storage is busy. Close other tabs and try again."));
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function accessDraft(
  draftKey: string,
  change?: { items: SocialGalleryDraftItem[] | null },
): Promise<unknown> {
  if (!nonempty(draftKey)) throw new Error("A gallery draft needs its account-bound draft key.");
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, change ? "readwrite" : "readonly");
      const store = transaction.objectStore(STORE);
      let value: unknown;
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = () => reject(transaction.error ?? new Error("Photo draft storage failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Photo draft save was interrupted."));
      if (change) {
        if (change.items === null) store.delete(draftKey);
        else store.put(change.items, draftKey);
      } else {
        const request = store.get(draftKey);
        request.onsuccess = () => { value = request.result; };
      }
    });
  } finally {
    db.close();
  }
}

/** Pass the composer's full account-bound draftKey, including its post scope, unchanged. */
export async function saveSocialGalleryDraft(draftKey: string, items: readonly SocialGalleryDraftItem[]): Promise<void> {
  if (!validPhotos(items)) throw new Error("A gallery draft needs up to 10 photos with unique upload keys.");
  // Snapshot metadata before awaiting storage. File objects are immutable.
  await accessDraft(draftKey, { items: items.map((item) => ({ ...item })) });
}

/** Null means absent. A failed or malformed read must not look like an empty draft. */
export async function readSocialGalleryDraft(draftKey: string): Promise<SocialGalleryDraftItem[] | null> {
  const value = await accessDraft(draftKey);
  if (value === undefined) return null;
  if (!validPhotos(value)) throw new Error("Could not restore these photo drafts. Choose the photos again.");
  return value;
}

export async function clearSocialGalleryDraft(draftKey: string): Promise<void> {
  await accessDraft(draftKey, { items: null });
}
