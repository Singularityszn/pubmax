"use client";

// Shown over the map when the coffee lens could not read the Shoreditch pilot.
// A lens that drew no cafes on a failed read would say Shoreditch has no listed
// coffee, so the failure is named and the reader can ask again.

export default function CoffeePilotLoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <aside className="mapSearchEmpty" role="status" data-testid="coffee-pilot-load-failed">
      <span className="mapSearchEmptyMessage">Shoreditch coffee prices could not load</span>
      <button type="button" className="mapSearchEmptyAction" onClick={onRetry}>
        Retry
      </button>
    </aside>
  );
}
