type ResolveMapLogIntentInput = {
  hasLogIntent: boolean;
  loaded: boolean;
  selectedVenueId: string;
  selectedVenueResolvable: boolean;
  firstRouteId: string;
  firstFilteredVenueId: string;
};

export type MapLogIntentResolution =
  | { status: "inactive" }
  | { status: "pending" }
  | { status: "open"; venueId: string }
  | { status: "fallback" };

type QueryLike = string | { get(name: string): string | null };

export function hasMapLogIntent(query: QueryLike): boolean {
  if (typeof query !== "string") return query.get("log") === "1";
  const normalized = query.startsWith("?") ? query.slice(1) : query;
  return new URLSearchParams(normalized).get("log") === "1";
}

export function shouldRunMapLogIntent(input: {
  hasLogIntent: boolean;
  handled: boolean;
}): boolean {
  return input.hasLogIntent && !input.handled;
}

export function resolveMapLogIntent(input: ResolveMapLogIntentInput): MapLogIntentResolution {
  if (!input.hasLogIntent) return { status: "inactive" };
  if (!input.loaded) return { status: "pending" };

  const selectedVenueId =
    input.selectedVenueId && input.selectedVenueResolvable ? input.selectedVenueId : "";
  const venueId = selectedVenueId || input.firstRouteId || input.firstFilteredVenueId;
  return venueId ? { status: "open", venueId } : { status: "fallback" };
}
