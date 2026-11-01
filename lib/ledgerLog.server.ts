import "server-only";

import type { VenueCuration, VenueClaim } from "@/lib/curation";
import {
  buildFamilyTableEntries,
  buildLedgerEntries,
  buildVenueClaims,
  ledgerClaimDrops,
  resolveFamilyTableDisplay,
  type FamilyTableEntry,
  type LedgerEntry,
  type LedgerPintPrice,
  type LedgerSourceDrop,
  type RedactedFamilyEntry,
} from "@/lib/ledger";
import type { ViewerContext } from "@/lib/pintDrops";
import {
  memoryPintDropStore,
  supabasePintDropStore,
  type PintDropDTO,
} from "@/lib/pintDropsStore";
import { pintTrustFor } from "@/lib/pintTrust";
import { isUncheckedPrice } from "@/lib/pintDropReceipt";
import { isSupabaseConfigured } from "@/lib/supabase";

// THE LEDGER'S LIVE HALF (task vercel-f2-seo-cdn, option a). The /ledger/[id]
// document is prerendered and held by the CDN, so it carries only what the
// bundled dataset knows about the pub. Everything a person wrote - the public
// logbook, the story lines drops add, and the Family Table - is read here, per
// request, by GET /api/ledger/[id], and drawn on the client after load. Nothing
// a drinker wrote is ever in a cached copy, so a hidden, withdrawn or erased
// drop leaves the page the moment the store stops returning it.

export type LedgerLog = {
  /** The same public pint reading as the map sheet, never a private or demo row. */
  pintPrice: LedgerPintPrice | null;
  /** The pub's story: the curated note first, then every drop-derived line. */
  claims: VenueClaim[];
  /** The public logbook: public and anonymous drops only, newest first. */
  entries: LedgerEntry[];
  /** Legacy drops, in full for their author and redacted for everyone else. */
  familyEntries: Array<FamilyTableEntry | RedactedFamilyEntry>;
};

function pintDropStoreFor() {
  return isSupabaseConfigured() ? supabasePintDropStore : memoryPintDropStore;
}

function sourceOf(d: PintDropDTO): LedgerSourceDrop {
  return {
    id: d.id,
    handle: d.handle,
    drink: d.drink,
    priceGbp: d.priceGbp,
    passedDownNote: d.passedDownNote,
    era: d.era,
    provenance: d.provenance,
    createdAt: d.createdAt,
  };
}

/**
 * Read one venue's logbook and Family Table. `canonicalId` is the surviving
 * venue id (D1), never a raw route param, so a merged alias and its canonical
 * address share one logbook. `viewer` only ever unredacts the viewer's OWN
 * legacy rows; the public logbook is read with no viewer at all, exactly as the
 * server-rendered page read it.
 */
export async function readLedgerLog(
  canonicalId: string,
  curation: VenueCuration,
  viewer: ViewerContext | undefined,
): Promise<LedgerLog> {
  const store = pintDropStoreFor();
  const publicDrops = await store.listVisible(canonicalId);
  const sources = publicDrops.map(sourceOf);
  const trust = pintTrustFor(publicDrops);
  const pintPrice: LedgerPintPrice | null = trust.drop && trust.state !== "none" ? {
    dropId: trust.drop.id,
    drink: trust.drop.drink,
    measure: "pint",
    priceGbp: trust.priceGbp,
    createdAt: trust.drop.createdAt,
    handle: trust.drop.handle,
    state: trust.state,
    split: trust.split,
    // A typed price with no bill is named as such on the record (decision 9).
    ...(isUncheckedPrice(trust.drop) ? { unchecked: true as const } : {}),
  } : null;
  // The Family Table (issue #27): LEGACY drops, read via the ledger-only
  // listLegacyForVenue capability (issue #29), deliberately a SEPARATE store
  // call from listVisible above, never a filter over it, so a legacy row can
  // never end up in the public logbook.
  const legacySources = (await store.listLegacyForVenue(canonicalId)).map(sourceOf);
  return {
    pintPrice,
    claims: buildVenueClaims(curation, ledgerClaimDrops(sources)),
    entries: buildLedgerEntries(sources),
    familyEntries: resolveFamilyTableDisplay(
      buildFamilyTableEntries(legacySources),
      legacySources,
      viewer?.handle,
    ),
  };
}
