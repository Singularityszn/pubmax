import "server-only";

import { venueIdMatchesCity } from "@/lib/cityVenueIds";
import type { FeaturedOpenTableSelection } from "@/lib/featuredOpenTableSelection";
import { openCrawlJoinWindow, openCrawlPlacesLine } from "@/lib/openCrawl";
import { loadOpenCrawlPublicPreview } from "@/lib/openCrawlShareCard.server";
import { selectSummonPrice, summonPriceSentence } from "@/lib/summonPrice";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { lookupCanonicalVenue } from "@/lib/venueIndex";

/** The public facts one selected night may print. No stored id beyond the crew's own link. */
export type FeaturedOpenTable = {
  crewId: string;
  hostHandle: string;
  meetingPubName: string;
  startsAt: string;
  /** Null when the count was not read. Never derived from capacity. */
  placesLine: string | null;
  price: { sentence: string; sourceUrl: string } | null;
};

/**
 * `missing` covers an invalid selection and any drift from it: Social keeps its
 * general crawl link. `unavailable` is a read that could not run.
 */
export type FeaturedOpenTableResult =
  | { status: "not-configured" }
  | { status: "missing" }
  | { status: "unavailable" }
  | { status: "upcoming"; table: FeaturedOpenTable };

const MISSING: FeaturedOpenTableResult = { status: "missing" };
const UNAVAILABLE: FeaturedOpenTableResult = { status: "unavailable" };

function validSelection(selection: FeaturedOpenTableSelection): boolean {
  return (
    selection.crewId.length > 0 &&
    selection.hostHandle.length > 0 &&
    selection.meetingVenueId.length > 0 &&
    Number.isFinite(Date.parse(selection.startsAt))
  );
}

function insideJoinWindow(startMs: number, nowMs: number): boolean {
  const window = openCrawlJoinWindow(nowMs);
  return startMs >= Date.parse(window.from) && startMs < Date.parse(window.until);
}

/** The selected pub as the London index lists it, under its own canonical id. */
async function londonPub(venueId: string): Promise<"listed" | "missing" | "unavailable"> {
  const lookup = await lookupCanonicalVenue(venueId);
  if (lookup.status === "unavailable") return "unavailable";
  if (lookup.status !== "found" || lookup.canonicalId !== venueId) return "missing";
  return venueIdMatchesCity(venueId, "london") ? "listed" : "missing";
}

async function datedPrice(venueId: string, nowMs: number): Promise<FeaturedOpenTable["price"]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The detail reader cannot be cancelled. Its late answer must not delay Social.
    const detail = await Promise.race([
      lookupVenueDetail(venueId),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 1500); }),
    ]);
    if (!detail || detail.status !== "found" || detail.venue.id !== venueId) return null;
    const evidence = selectSummonPrice(detail.venue, nowMs);
    return evidence ? { sentence: summonPriceSentence(evidence), sourceUrl: evidence.sourceUrl } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadFeaturedOpenTable(
  selection: FeaturedOpenTableSelection | null,
  nowMs: number = Date.now(),
): Promise<FeaturedOpenTableResult> {
  if (!selection) return { status: "not-configured" };
  if (!validSelection(selection)) return MISSING;
  const preview = await loadOpenCrawlPublicPreview(selection.crewId, { includeOptionalFacts: false });
  if (!preview.ok) return preview.reason === "unavailable" ? UNAVAILABLE : MISSING;

  const { card, meetingVenueId, singleStopVenueId } = preview;
  const startMs = Date.parse(card.startsAt);
  const matches =
    card.crewId === selection.crewId &&
    card.hostHandle === selection.hostHandle &&
    singleStopVenueId !== null &&
    singleStopVenueId === meetingVenueId &&
    meetingVenueId === selection.meetingVenueId &&
    startMs === Date.parse(selection.startsAt) &&
    insideJoinWindow(startMs, nowMs);
  if (!matches || card.placesLeft === 0) return MISSING;

  const london = await londonPub(selection.meetingVenueId);
  if (london !== "listed") return london === "unavailable" ? UNAVAILABLE : MISSING;

  return {
    status: "upcoming",
    table: {
      crewId: card.crewId,
      hostHandle: card.hostHandle,
      meetingPubName: card.meetingPubName,
      startsAt: new Date(startMs).toISOString(),
      placesLine: card.placesLeft === null ? null : openCrawlPlacesLine(card.placesLeft),
      price: await datedPrice(selection.meetingVenueId, nowMs),
    },
  };
}
