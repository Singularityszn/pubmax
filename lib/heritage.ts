// "The Landlord" — a retrieval-grounded heritage Q&A helper for a single pub.
//
// Grounding contract: every answer is built ONLY from facts we retrieved. It
// reads back the stored, cited facts on record (Historic England, Wikidata,
// Wikipedia, OSM and cited harvest lore), or says plainly that there is no
// fuller story. No model is called: the facts are already stored, and an
// answer may only ever repeat one of them.

import "server-only";

import { normaliseVenueName } from "@/lib/curation";
import { heritageFactFromOverlay } from "@/lib/harvestFold";
import { harvestOverlayStore } from "@/lib/harvestOverlayStore";
import { resolveHarvestOverlayVenue } from "@/lib/harvestOverlayVenue";
import { getListedBuilding } from "@/lib/heritageListings";
import { loadHistoricPubs } from "@/lib/historic";
import { packWikidataHistoryForVenue } from "@/lib/wikidataHistory.server";
import { getVenueIndexSnapshot, lookupCanonicalVenue } from "@/lib/venueIndex";
import { venueKindNoun } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";
import type { HarvestOverlayVenueResolution } from "@/lib/harvestOverlayVenue";

export type HeritageFact = {
  source: "osm" | "wikidata" | "wikipedia" | "seed" | "nhle" | "web";
  fact: string;
  sourceRef?: string;
  /** ISO day the source was read, where the pack records one; the sheet prints it. */
  observedAt?: string;
};

// Sources that count as trusted/sourced facts (server-retrieved). "nhle" is
// Historic England's official National Heritage List for England. "web" is
// cited harvest lore, keyed by OSM id (never by pub name).
const SOURCED: ReadonlySet<HeritageFact["source"]> = new Set([
  "osm",
  "wikidata",
  "wikipedia",
  "seed",
  "nhle",
  "web",
]);

export function storedFactSource(value: unknown): HeritageFact["source"] | null {
  const source = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (source === "web") return null;
  if (!SOURCED.has(source as HeritageFact["source"])) return null;
  return source as HeritageFact["source"];
}

export type HeritageResponse = {
  answer: string;
  citations: { source: string; ref?: string }[];
  clarifyingQuestion?: string;
};

export const NO_STORY_LINE =
  "I've got the basics but no fuller story on record yet. I won't make one up.";

export type HeritageReadResult = {
  status: "ready" | "degraded";
  facts: HeritageFact[];
};

export async function retrieveHeritageWithStatus(input: {
  venueId?: string;
  venueName: string;
  overlayVenueResolution?: HarvestOverlayVenueResolution;
}): Promise<HeritageReadResult> {
  const facts: HeritageFact[] = [];
  let status: HeritageReadResult["status"] = "ready";
  const overlayResolution = input.venueId
    ? input.overlayVenueResolution ?? (await resolveHarvestOverlayVenue(input.venueId))
    : undefined;
  const baseVenueLookup = input.venueId
    ? await lookupCanonicalVenue(input.venueId)
    : undefined;
  let venueId = baseVenueLookup?.status === "found"
    ? baseVenueLookup.canonicalId
    : input.venueId;
  if (!input.venueId) {
    const snapshot = await getVenueIndexSnapshot();
    if (!snapshot.complete) status = "degraded";
    const matches = [...snapshot.index.values()].filter(
      (venue) => normaliseVenueName(venue.name) === normaliseVenueName(input.venueName),
    );
    venueId = snapshot.complete && matches.length === 1 ? matches[0]?.id : undefined;
  }

  // (0) Listed-building fact first — the official register (Historic England
  // NHLE), keyed by the exact venue id so it can never attach to the wrong
  // same-named pub. This is the authoritative "brass plaque" line, so it leads.
  const listed = await getListedBuilding(input.venueId);
  if (listed) {
    facts.push({
      source: "nhle",
      fact: listed.fact,
      sourceRef: listed.url,
      ...(listed.retrievedAt ? { observedAt: listed.retrievedAt } : {}),
    });
  }

  if (input.venueId) facts.push(...(await packWikidataHistoryForVenue(input.venueId)));

  if (venueId) {
    const pubs = await loadHistoricPubs();
    for (const pub of pubs) {
      if (pub.venueId !== venueId || !Array.isArray(pub.facts)) continue;
      for (const entry of pub.facts) {
        if (!entry || typeof entry.fact !== "string" || !entry.fact.trim()) continue;
        const source = storedFactSource(entry.source);
        if (!source) continue;
        facts.push({ source, fact: entry.fact, sourceRef: entry.sourceRef });
      }
    }
  }

  // (3) Harvest overlay lore — OSM id only. Name is never a key. Uncited
  // lore cannot be stored, and heritageFactFromOverlay drops a row that
  // somehow lost its https citation.
  if (input.venueId && overlayResolution) {
    const resolution = overlayResolution;
    if (resolution.status === "unavailable") {
      status = "degraded";
    } else if (resolution.status === "resolved") {
      const reads = await Promise.all(
        resolution.venueIds.map((osmId) => harvestOverlayStore().getByVenueId(osmId)),
      );
      if (reads.some((read) => read.status === "degraded")) {
        status = "degraded";
      } else {
        for (const read of reads) {
          const lore = read.status === "ready" && read.overlay
            ? heritageFactFromOverlay(read.overlay)
            : null;
          if (lore) facts.push(lore);
        }
      }
    }
  }

  // No client context is accepted — the route derives everything from
  // server-owned stores.
  return { status, facts };
}

export async function retrieveHeritage(input: {
  venueId?: string;
  venueName: string;
  overlayVenueResolution?: HarvestOverlayVenueResolution;
}): Promise<HeritageFact[]> {
  return (await retrieveHeritageWithStatus(input)).facts;
}

function dedupeCitations(
  facts: HeritageFact[],
): { source: string; ref?: string }[] {
  const seen = new Set<string>();
  const citations: { source: string; ref?: string }[] = [];
  for (const fact of facts) {
    const key = `${fact.source}::${fact.sourceRef ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(fact.sourceRef ? { source: fact.source, ref: fact.sourceRef } : { source: fact.source });
  }
  return citations;
}

// Honest structured-only answer: read the facts back, never add to them.
function structuredAnswer(facts: HeritageFact[]): string {
  if (facts.length === 0) return NO_STORY_LINE;
  return `Here's what's on record: ${facts.map((f) => f.fact.replace(/\.$/, "")).join("; ")}.`;
}

export async function answerHeritage(input: {
  venueId?: string;
  venueName: string;
  venueKind?: VenueKind;
  question: string;
  overlayVenueResolution?: HarvestOverlayVenueResolution;
}): Promise<HeritageResponse> {
  const venueNoun = venueKindNoun(input.venueKind);
  const heritageRead = await retrieveHeritageWithStatus(input);
  const citations = dedupeCitations(heritageRead.facts);
  const seenFacts = new Set<string>();
  const facts = heritageRead.facts.filter(({ fact }) => {
    const key = fact.normalize("NFC").trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").toLowerCase();
    if (seenFacts.has(key)) return false;
    seenFacts.add(key);
    return true;
  });

  const response: HeritageResponse = { answer: structuredAnswer(facts), citations };
  if (facts.length === 0) {
    response.clarifyingQuestion = `What would you like to know about this ${venueNoun}?`;
  }
  return response;
}
