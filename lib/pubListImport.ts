/** Public import contracts. Pasted lines exist only during the active review. */
export type ImportSource = {
  url: string;
  platform: "tiktok" | "instagram" | "other";
  handle: string | null;
};

export type ImportCandidate = {
  id: string;
  name: string;
  area: string;
  postcodeDistrict?: string;
  lat?: number;
  lng?: number;
  layer: "curated" | "national";
  price?: null;
  hasPrice?: boolean;
  closed?: true;
};

type ExtractedLine = { rawLine: string; name: string; areaHint: string };
export type ImportItem = ExtractedLine & (
  | { state: "matched" | "closed"; venue: ImportCandidate }
  | { state: "ambiguous"; candidates: ImportCandidate[]; candidateCount: number }
  | { state: "unmatched" }
);

/** A private Planned Night draft, before its owner chooses a crawl and time. */
export type PubListNightDraft = {
  id: string;
  venueIds: string[];
  source: ImportSource | null;
  createdAt: string;
};
