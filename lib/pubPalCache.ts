import { cleanPalDraft, type PubPal } from "@/lib/pubPal";

const PAL_CACHE_KEY = "pubmax_pub_pal_v1";
const PAL_CACHE_CHANGED_EVENT = "pubmax:pub-pal-cache-changed";

export function readOwnedPalCache(ownerId: string): PubPal | null {
  if (!ownerId || typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(PAL_CACHE_KEY) ?? "null") as PubPal | null;
    if (value?.ownerId !== ownerId) return null;
    const draft = cleanPalDraft({
      ...value,
      adultConfirmed: typeof value.adultAttestedAt === "string" && value.adultAttestedAt.length > 0,
    });
    if (!draft) return null;
    return {
      ...value,
      name: draft.name,
      appearance: draft.appearance,
      personality: draft.personality,
      voice: draft.voice,
      proposalPreferences: value.proposalPreferences ?? { memories: false, routes: true },
    };
  } catch {
    return null;
  }
}

export function writePalCache(pal: PubPal): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAL_CACHE_KEY, JSON.stringify(pal));
    window.dispatchEvent(new Event(PAL_CACHE_CHANGED_EVENT));
  } catch {
    // Account state remains usable when browser storage is unavailable.
  }
}

export function clearOwnedPalCache(ownerId: string): void {
  if (typeof window === "undefined" || !readOwnedPalCache(ownerId)) return;
  try {
    window.localStorage.removeItem(PAL_CACHE_KEY);
    window.dispatchEvent(new Event(PAL_CACHE_CHANGED_EVENT));
  } catch {
    // Account deletion does not depend on browser storage.
  }
}

export function subscribePalCache(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && (event.key === PAL_CACHE_KEY || event.key === null)) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(PAL_CACHE_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(PAL_CACHE_CHANGED_EVENT, listener);
  };
}
