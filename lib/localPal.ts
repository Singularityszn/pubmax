import type { PubPal } from "@/lib/pubPal";
import { safeLocalStorage } from "@/lib/safeStorage";

// The Pal this browser last saved (PalExperience writes it). Surfaces outside
// /pal read it to show the person's own Pal; it is a cache, never the source of
// truth, so a malformed or missing copy reads as no Pal.
const LOCAL_PAL_KEY = "pubmax_pub_pal_v1";

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
