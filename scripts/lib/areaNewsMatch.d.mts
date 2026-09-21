export function slugifyBorough(name: unknown): string;

export type AreaNewsVenue = { id: string; name: string; borough: string };

export function collectAreaNewsCandidates(
  pubName: unknown,
  boroughSlug: unknown,
  venues: AreaNewsVenue[],
): {
  pubTokens: string[];
  exact: AreaNewsVenue[];
  subset: AreaNewsVenue[];
};

export function matchVenue(
  pubName: unknown,
  boroughSlug: unknown,
  venues: AreaNewsVenue[],
): { venueId: string; confidence: "high" | "medium" } | null;
