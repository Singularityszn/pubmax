"use client";

export default function MapSearchEmptyState({ query, matchCount, onShowMatches, onClear }: {
  query: string;
  matchCount: number;
  onShowMatches: () => void;
  onClear: () => void;
}) {
  return (
    <aside className="mapSearchEmpty" role="status" aria-label={`Matches for ${query}`} data-testid="map-filter-empty">
      <span className="mapSearchEmptyMessage">No matching pubs in this view</span>
      <button type="button" className="mapSearchEmptyAction" onClick={onShowMatches}>
        {matchCount === 1 ? "Show the matching pub" : "Show matching pubs"}
      </button>
      <button type="button" className="mapSearchEmptyAction" onClick={onClear}>Clear search</button>
    </aside>
  );
}
