// Client-safe scraped-pub types and source helpers.
// Server listing lives in lib/scrapedPubs.server.ts (fs + enrichment join).

export type ScrapedPubSourceId =
  | "greene-king.co.uk"
  | "nicholsonspubs.co.uk"
  | "youngs.co.uk"
  | "other";

export type ScrapedPub = {
  id: string;
  name: string;
  borough: string;
  source: ScrapedPubSourceId;
  sourceLabel: string;
  menuUrl?: string;
  bookingUrl?: string;
  /** Real scraped/menu photo when present (Greene King tiles, venue image). */
  photoUrl?: string;
  cheapestPrice: number | null;
  /** Nearest-station TfL fare zone (1–6), or null when unknown. */
  zone: number | null;
};

export const SCRAPED_SOURCE_LABELS: Record<ScrapedPubSourceId, string> = {
  "greene-king.co.uk": "Greene King",
  "nicholsonspubs.co.uk": "Nicholson's",
  "youngs.co.uk": "Young's",
  other: "Other",
};

export function normaliseScrapedSource(source: string | undefined): ScrapedPubSourceId {
  const value = String(source ?? "")
    .trim()
    .toLowerCase();
  if (value.includes("greene")) return "greene-king.co.uk";
  if (value.includes("nicholson")) return "nicholsonspubs.co.uk";
  if (value.includes("young")) return "youngs.co.uk";
  return "other";
}

export function countScrapedPubsBySource(
  pubs: readonly ScrapedPub[],
): Record<ScrapedPubSourceId, number> {
  const counts: Record<ScrapedPubSourceId, number> = {
    "greene-king.co.uk": 0,
    "nicholsonspubs.co.uk": 0,
    "youngs.co.uk": 0,
    other: 0,
  };
  for (const pub of pubs) counts[pub.source] += 1;
  return counts;
}
