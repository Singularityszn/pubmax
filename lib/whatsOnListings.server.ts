import "server-only";

// Store-first What's-On reader. Durable official-API rows win when present;
// the committed public/data/whats_on files remain the fallback. Expired rows
// are dropped here, matching filterNotPast on the serving spine.

import { preferDurableWhatsOn } from "@/lib/whatsOnListings";
import {
  whatsOnListingStore,
  type WhatsOnListingStore,
} from "@/lib/whatsOnListingStore";
import type { WhatsOnKind, WhatsOnRow } from "@/lib/whatsOn";

export type LoadServedWhatsOnListingsOpts = {
  store?: WhatsOnListingStore;
  bundled: WhatsOnRow[];
  now: number;
  kind?: WhatsOnKind;
};

export async function loadServedWhatsOnListings(
  opts: LoadServedWhatsOnListingsOpts,
): Promise<WhatsOnRow[]> {
  const store = opts.store ?? whatsOnListingStore();
  const snap = await store.readAll();
  const durable = opts.kind
    ? snap.rows.filter((row) => row.kind === opts.kind)
    : snap.rows;
  const bundled = opts.kind
    ? opts.bundled.filter((row) => row.kind === opts.kind)
    : opts.bundled;
  return preferDurableWhatsOn(durable, bundled, opts.now);
}
