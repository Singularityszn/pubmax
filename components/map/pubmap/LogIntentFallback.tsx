import { formatLogNearbyDistance, type LogNearbyCandidate } from "@/lib/mapLogIntent";

// Log-drop fallback panel: shown when a ?log= arrival can't auto-pick a venue.
// Offers the nearby-pub list (only "nearby" when a location fix exists), a
// search action, and a "show all pubs" escape when filters hide everything.
// Global CSS (logIntentFallback / logIntent*) is already imported by PubMap.
// Extracted verbatim from PubMap (F1); the logIntentFallbackVisible guard
// stays in PubMap. Owns formatLogNearbyDistance.
export function LogIntentFallback({
  candidates,
  hasUserLocation,
  filteredVenueCount,
  onPickVenue,
  onPrefetchVenue,
  onFocusSearch,
  onResetFilters,
}: {
  candidates: LogNearbyCandidate[];
  hasUserLocation: boolean;
  filteredVenueCount: number;
  onPickVenue: (id: string) => void;
  onPrefetchVenue: (id: string) => void;
  onFocusSearch: () => void;
  onResetFilters: () => void;
}) {
  return (
    <div className="logIntentFallback" role="status" aria-live="polite">
      <div>
        <strong>Pick a pub to log a Pint Drop</strong>
        <p className="description">
          {hasUserLocation
            ? "Nearest pubs to you first. Choose one, search, or tap the map — then we’ll open the Pint Drop composer."
            : "We won’t guess which pub you’re in. Choose one below, search, or tap the map — then we’ll open the Pint Drop composer."}
        </p>
      </div>
      {candidates.length > 0 ? (
        /* U6e — only claim "nearby" when we actually have a location fix;
           without one the list is just the filtered map order. */
        <ul
          className="logIntentNearbyList"
          aria-label={hasUserLocation ? "Nearby pubs to log" : "Pubs to log"}
        >
          {candidates.map((candidate) => {
            const dist =
              typeof candidate.distanceKm === "number" &&
              Number.isFinite(candidate.distanceKm)
                ? formatLogNearbyDistance(candidate.distanceKm)
                : "";
            return (
              <li key={candidate.id}>
                <button
                  type="button"
                  className="logIntentNearbyBtn"
                  onClick={() => onPickVenue(candidate.id)}
                  onPointerEnter={() => onPrefetchVenue(candidate.id)}
                  onTouchStart={() => onPrefetchVenue(candidate.id)}
                >
                  <span>{candidate.name}</span>
                  <span className="logIntentNearbyMeta">
                    {dist ? <span className="logIntentNearbyDist">{dist}</span> : null}
                    <span>{candidate.priceLabel}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="logIntentActions">
        <button type="button" className="addStopBtn" onClick={onFocusSearch}>
          Search pubs
        </button>
        {filteredVenueCount === 0 ? (
          <button type="button" className="addStopBtn" onClick={onResetFilters}>
            Show all pubs
          </button>
        ) : null}
      </div>
    </div>
  );
}
