import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { venueSiteFactsFromRow, type VenueSiteFacts } from "@/lib/venueSiteFacts";
import { VENUE_SITE_FACTS_TRACING_INCLUDE } from "@/lib/venueSiteFactsFile.mjs";

let cachedByVenueId: Promise<ReadonlyMap<string, VenueSiteFacts>> | undefined;

async function readByVenueId(): Promise<ReadonlyMap<string, VenueSiteFacts>> {
  const byVenueId = new Map<string, VenueSiteFacts>();
  const conflicted = new Set<string>();
  try {
    const file = JSON.parse(await readFile(path.join(process.cwd(), VENUE_SITE_FACTS_TRACING_INCLUDE), "utf8"));
    if (file.version !== 1 || !Array.isArray(file.rows)) return byVenueId;
    for (const row of file.rows) {
      const venueId = (row as { venueId?: unknown } | null)?.venueId;
      const facts = venueSiteFactsFromRow(row);
      if (typeof venueId !== "string" || !facts) continue;
      const previous = byVenueId.get(venueId);
      // Two reads that name one venue and disagree have stated nothing about it.
      if (previous && JSON.stringify(previous) !== JSON.stringify(facts)) conflicted.add(venueId);
      byVenueId.set(venueId, facts);
    }
  } catch {
    return new Map();
  }
  for (const venueId of conflicted) byVenueId.delete(venueId);
  return byVenueId;
}

/** What the pub's own site states about dogs and opening hours, or null. A missing or unreadable file states nothing. */
export async function siteFactsForVenue(venueId: string): Promise<VenueSiteFacts | null> {
  cachedByVenueId ??= readByVenueId();
  return (await cachedByVenueId).get(venueId) ?? null;
}
