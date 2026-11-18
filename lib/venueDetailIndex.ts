import "server-only";

import {
  clearVenueDetailFallbackForTests,
  readVenueDetailBase,
  resetVenueDetailArtifactForTests,
  resolveVenueDetailId,
  setVenueDetailArtifactFilesForTests,
} from "@/lib/venueDetailArtifact.server";
import { lookupCanonicalVenue, lookupRetiredIndexedVenue, venueOsmIds } from "@/lib/venueIndex";
import {
  lookupCanonicalVenueWithOsm,
  resetVenueOsmIndexForTests,
} from "@/lib/venueIndexOsm";
import { slimVenueToPin } from "@/lib/slimPins";
import { applyHarvestWebsiteMenu } from "@/lib/harvestFold";
import { harvestOverlayStore } from "@/lib/harvestOverlayStore";
import { enrichVenueForDetail } from "@/lib/venueMenuEnrichment";
import { applyPlacesEnrichment } from "@/lib/venuePlacesEnrichment";
import { applyVenueSiteFacts } from "@/lib/venueSiteFacts";
import { siteFactsForVenue } from "@/lib/venueSiteFacts.server";
import { osmFactsForOsmIds } from "@/lib/osmPubFacts.server";
import { placesRecordForVenue } from "@/lib/placesEnrichment.server";
import { enrichVenueWithRecordCopy } from "@/lib/venueRecordCopy.server";
import type { Venue } from "@/lib/venues";

export {
  getManifestReadAttemptsForTests,
  isVenueDetailId,
  venueFromDetailArtifact,
  type VenueDetailArtifact,
} from "@/lib/venueDetailArtifact.server";

// Only a venue the index knows reaches this cache, but a crawler walking every
// pub page still fills it with the whole city pack, and each entry is a fully
// enriched record. Bounded with insertion-order eviction, the same house
// pattern as lib/heritage.ts, so one warm function cannot hold every venue.
// A read refreshes an entry, so the order is least recently used.
const VENUE_DETAIL_CACHE_MAX_ENTRIES = 1_000;
let venueDetailCacheMax = VENUE_DETAIL_CACHE_MAX_ENTRIES;
const cachedDetails = new Map<string, { venue: Venue; overlayVenueIds?: string[]; priceDatasetDigest?: string }>();

function setCachedDetail(id: string, entry: { venue: Venue; overlayVenueIds?: string[]; priceDatasetDigest?: string }): void {
  if (cachedDetails.has(id)) cachedDetails.delete(id);
  cachedDetails.set(id, entry);
  while (cachedDetails.size > venueDetailCacheMax) {
    const oldest = cachedDetails.keys().next().value;
    if (oldest === undefined) break;
    cachedDetails.delete(oldest);
  }
}

export function venueDetailCachedIdsForTests(): string[] {
  return isTestRuntime() ? [...cachedDetails.keys()] : [];
}

export function setVenueDetailCacheMaxForTests(max: number | null): void {
  if (!isTestRuntime()) return;
  venueDetailCacheMax = max ?? VENUE_DETAIL_CACHE_MAX_ENTRIES;
}

/**
 * `retired` names a pub that left the map. Every reader treats it as `missing`
 * unless it opts in to show the tombstone: only /api/venue/[id] does, so the
 * map can say the pub may have closed. No page, unfurl or invite route answers
 * a retired id as a live pub.
 */
export type VenueDetailLookupResult =
  | { status: "found"; venue: Venue; priceDatasetDigest?: string }
  | { status: "retired"; venue: Venue }
  | { status: "missing" }
  | { status: "unavailable" };

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    Boolean(process.env.VITEST_WORKER_ID)
  );
}

function foundDetail(venue: Venue, digest?: string): VenueDetailLookupResult {
  return digest ? { status: "found", venue, priceDatasetDigest: digest } : { status: "found", venue };
}

async function lookupVenueDetailBase(requestedId: string): Promise<VenueDetailLookupResult> {
  const resolved = await resolveVenueDetailId(requestedId);
  if (resolved.status !== "resolved") return resolved;
  const { id } = resolved;
  const cached = cachedDetails.get(id);
  if (cached) {
    // A hit moves the venue to the newest end, so the pubs people keep
    // opening tonight are the last the bound evicts.
    cachedDetails.delete(id);
    cachedDetails.set(id, cached);
    try {
      let overlayVenueIds = cached.overlayVenueIds;
      if (!overlayVenueIds) {
        const osmLookup = await lookupCanonicalVenueWithOsm(id);
        if (osmLookup.status === "found") {
          overlayVenueIds = venueOsmIds(osmLookup.venue);
          cached.overlayVenueIds = overlayVenueIds;
        }
      }
      if (!overlayVenueIds?.length) return foundDetail(cached.venue, cached.priceDatasetDigest);
      const reads = await Promise.all(
        overlayVenueIds.map((osmId) => harvestOverlayStore().getByVenueId(osmId)),
      );
      if (reads.some((read) => read.status === "degraded")) {
        return foundDetail(cached.venue, cached.priceDatasetDigest);
      }
      const venue = reads.reduce(
        (current, read) =>
          read.status === "ready" ? applyHarvestWebsiteMenu(current, read.overlay) : current,
        cached.venue,
      );
      return foundDetail(venue, cached.priceDatasetDigest);
    } catch {
      return foundDetail(cached.venue, cached.priceDatasetDigest);
    }
  }

  const venueLookup = await lookupCanonicalVenue(id);
  if (venueLookup.status === "unavailable") return { status: "unavailable" };
  if (venueLookup.status === "unknown") {
    const retired = await lookupRetiredIndexedVenue(venueLookup.canonicalId);
    return retired ? { status: "retired", venue: slimVenueToPin(retired.slimVenue) } : { status: "missing" };
  }

  const base = await readVenueDetailBase(id, venueLookup.slimVenue);
  if (!base) return { status: "unavailable" };
  const { priceDatasetDigest } = base;
  const venue = await enrichVenueWithRecordCopy(base.venue);

  try {
    const enriched = await enrichVenueForDetail(venue);
    let overlayVenueIds: string[] | undefined;
    try {
      const osmLookup = await lookupCanonicalVenueWithOsm(id);
      if (osmLookup.status === "found") {
        overlayVenueIds = venueOsmIds(osmLookup.venue);
      }
    } catch {
      overlayVenueIds = undefined;
    }
    setCachedDetail(id, { venue: enriched, ...(overlayVenueIds ? { overlayVenueIds } : {}), ...(priceDatasetDigest ? { priceDatasetDigest } : {}) });
    if (!overlayVenueIds?.length) return foundDetail(enriched, priceDatasetDigest);
    const reads = await Promise.all(
      overlayVenueIds.map((osmId) => harvestOverlayStore().getByVenueId(osmId)),
    );
    if (reads.some((read) => read.status === "degraded")) return foundDetail(enriched, priceDatasetDigest);
    const mergedVenue = reads.reduce(
      (current, read) =>
        read.status === "ready" ? applyHarvestWebsiteMenu(current, read.overlay) : current,
      enriched,
    );
    return foundDetail(mergedVenue, priceDatasetDigest);
  } catch {
    return foundDetail(venue, priceDatasetDigest);
  }
}

export async function lookupVenueDetail(requestedId: string): Promise<VenueDetailLookupResult> {
  const result = await lookupVenueDetailBase(requestedId);
  if (result.status !== "found") return result;
  const osmIds = cachedDetails.get(result.venue.id)?.overlayVenueIds ?? [];
  const [record, siteFacts, osmFacts] = await Promise.all([
    placesRecordForVenue(result.venue.id, osmIds),
    siteFactsForVenue(result.venue.id),
    osmFactsForOsmIds(osmIds),
  ]);
  const venue = applyPlacesEnrichment(applyVenueSiteFacts(result.venue, siteFacts), record);
  // OSM facts ride beside the other sources and decide no open state.
  return { ...result, venue: osmFacts ? { ...venue, osmFacts } : venue };
}

export async function getVenueDetail(requestedId: string): Promise<Venue | null> {
  const result = await lookupVenueDetail(requestedId);
  return result.status === "found" ? result.venue : null;
}

export function resetVenueDetailCachesForTests(): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  venueDetailCacheMax = VENUE_DETAIL_CACHE_MAX_ENTRIES;
  resetVenueDetailArtifactForTests();
  resetVenueOsmIndexForTests();
}

/** Clear venue entries only — leaves manifest cache as-is (for sticky-failure tests). */
export function clearVenueDetailEntriesForTests(): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  clearVenueDetailFallbackForTests();
}

export function setVenueDetailIndexFileForTests(file: string): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  setVenueDetailArtifactFilesForTests({ indexFile: file });
}

export function setVenueDetailRowsFileForTests(file: string): void {
  if (!isTestRuntime()) return;
  cachedDetails.clear();
  setVenueDetailArtifactFilesForTests({ rowsFile: file });
}
