import "server-only";

import { buildBarTab, normalizePintDrop, type BarTab } from "@/lib/feed";

import { readPublicPricePresence } from "@/lib/publicPricePresence.server";
import type { PublicPricePresence } from "@/lib/publicPricePresence";
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

// Read contributions per request so visibility changes apply on the next read.
// The cache contract is owned by
// docs/rules/app-proxy-csp-caching-and-file-tracing.md.

export type LedgerLog = {
  barTab: BarTab;
  publicPricePresence: PublicPricePresence;
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
 * Read one venue's public tab, logbook and Family Table.
 * `canonicalId` is the surviving venue id (D1), never a raw route param,
 * so a merged alias and its canonical
 * address share one logbook. `viewer` only ever unredacts the viewer's OWN
 * legacy rows. The public logbook and tab are read without a viewer.
 */
export async function readLedgerLog(
  canonicalId: string,
  curation: VenueCuration,
  viewer: ViewerContext | undefined,
): Promise<LedgerLog> {
  const store = pintDropStoreFor();
  const [publicDrops, presence] = await Promise.all([store.listVisible(canonicalId), readPublicPricePresence([canonicalId])]);
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
    // Keep the record's wording consistent with the server-owned evidence.
    ...(isUncheckedPrice(trust.drop) ? { unchecked: true as const } : {}),
  } : null;
  // The Family Table (issue #27): LEGACY drops, read via the ledger-only
  // listLegacyForVenue capability (issue #29), deliberately a SEPARATE store
  // call from listVisible above, never a filter over it, so a legacy row can
  // never end up in the public logbook.
  const legacySources = (await store.listLegacyForVenue(canonicalId)).map(sourceOf);
  return {
    barTab: buildBarTab(publicDrops.map(normalizePintDrop)),
    pintPrice,
    publicPricePresence: presence[canonicalId] ?? "unknown",
    claims: buildVenueClaims(curation, ledgerClaimDrops(sources)),
    entries: buildLedgerEntries(sources),
    familyEntries: resolveFamilyTableDisplay(
      buildFamilyTableEntries(legacySources),
      legacySources,
      viewer?.handle,
    ),
  };
}
