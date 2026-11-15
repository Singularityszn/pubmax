import "server-only";

import { parseChainDenylist, pubSpecificEvidence, type ChainDenylist, type HarvestEvidenceRow } from "@/lib/harvest/pubWebsiteAmenities";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import { isVenueFeatureObservation, type VenueFeatureObservation } from "@/lib/venueFeatureEvidence";

type WebsiteAmenityKey = "darts" | "pool";

type VenueWebsiteAmenities = Partial<Record<WebsiteAmenityKey, readonly VenueFeatureObservation[]>>;

const WEBSITE_AMENITY_KEYS: readonly WebsiteAmenityKey[] = ["darts", "pool"];

const byRows = new WeakMap<object, { chainFile: unknown; byVenue: ReadonlyMap<string, VenueWebsiteAmenities> }>();

function evidenceRow(value: unknown): HarvestEvidenceRow | null {
  const row = value as Record<string, unknown> | null;
  if (!row || typeof row.osmId !== "string" || !row.osmId || typeof row.sourceUrl !== "string") return null;
  if (!/^https?:\/\//i.test(row.sourceUrl) || !URL.canParse(row.sourceUrl)) return null;
  if (!row.amenities || typeof row.amenities !== "object" || Array.isArray(row.amenities)) return null;
  return {
    osmId: row.osmId,
    sourceUrl: row.sourceUrl,
    venueId: canonicalOutVenueId(row.venueId),
    ...(typeof row.verifiedAt === "string" ? { verifiedAt: row.verifiedAt } : {}),
    amenities: Object.fromEntries(Object.entries(row.amenities).filter(([, quote]) => typeof quote === "string")),
  };
}

function websiteAmenitiesByVenue(rows: readonly unknown[], chain: ChainDenylist): ReadonlyMap<string, VenueWebsiteAmenities> {
  const byVenue = new Map<string, VenueWebsiteAmenities>();
  const parsed = rows.flatMap((row) => evidenceRow(row) ?? []);
  for (const row of pubSpecificEvidence(parsed, chain)) {
    if (!row.venueId) continue;
    for (const key of WEBSITE_AMENITY_KEYS) {
      const observation = [true, "Pub website", row.verifiedAt] as const;
      if (!row.amenities[key] || !isVenueFeatureObservation(observation)) continue;
      const held = byVenue.get(row.venueId) ?? {};
      byVenue.set(row.venueId, { ...held, [key]: [...(held[key] ?? []), observation] });
    }
  }
  return byVenue;
}

export async function loadWebsiteAmenitiesByVenue(): Promise<ReadonlyMap<string, VenueWebsiteAmenities>> {
  const file = (await import("@/data/amenities/london_pub_website_evidence.json")).default as { version?: unknown; rows?: unknown };
  const rows = file.rows;
  if (file.version !== 1 || !Array.isArray(rows)) throw new Error("pub website evidence has no rows");
  const chainFile: unknown = (await import("@/data/amenities/london_pub_website_chain_pages.json")).default;
  const held = byRows.get(rows);
  if (held && held.chainFile === chainFile) return held.byVenue;
  const byVenue = websiteAmenitiesByVenue(rows, parseChainDenylist(chainFile));
  byRows.set(rows, { chainFile, byVenue });
  return byVenue;
}
