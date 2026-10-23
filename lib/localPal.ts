import type { PubPal } from "@/lib/pubPal";
import { safeLocalStorage } from "@/lib/safeStorage";

// The Pal this browser last saved (PalExperience writes it). Surfaces outside
// /pal read it to show the person's own Pal; it is a cache, never the source of
// truth, so a malformed or missing copy reads as no Pal.
// It speaks for its owner (a name and a portrait), so it is one of the
// device identity keys (lib/deviceAccountIdentity.ts) and goes when the account
// on the device changes or signs out.
export const LOCAL_PAL_KEY = "pubmax_pub_pal_v1";

export function readLocalPal(): PubPal | null {
  try {
    const raw = safeLocalStorage()?.getItem(LOCAL_PAL_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PubPal> | null;
    if (!value || typeof value !== "object" || !value.id || !value.appearance) return null;
    return value as PubPal;
  } catch {
    return null;
  }
}

// A browser sends `storage` only to OTHER tabs, so the page that writes the Pal
// (PalExperience) says so in its own tab too, and a reader hears both.
const LOCAL_PAL_CHANGED_EVENT = "pubmax:local-pal-changed";

/** Tell this tab's readers that the stored Pal was written or removed. */
export function announceLocalPalChange(): void {
  try {
    window.dispatchEvent(new Event(LOCAL_PAL_CHANGED_EVENT));
  } catch {
    // No window, no reader to tell.
  }
}

/** Call `onChange` when the stored Pal changes in this tab or another. */
export function subscribeLocalPal(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LOCAL_PAL_KEY) onChange();
  };
  window.addEventListener(LOCAL_PAL_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(LOCAL_PAL_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
