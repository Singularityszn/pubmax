"use client";

/** Why the route on screen needs a refresh: an edit in this visit, or a route that came back from the device unchecked. */
export type RouteStaleCause = "changed" | "recovered";

const STALE_REASON: Record<RouteStaleCause, string> = {
  changed: "You’ve changed the night since we sorted it, so this preview may not fit any more.",
  recovered: "We sorted this one earlier. Prices and opening hours may have moved since.",
};

export default function PlanRouteStaleNotice({ cause, sorting, disabled, onRegenerate }: {
  cause: RouteStaleCause;
  sorting: boolean;
  disabled: boolean;
  onRegenerate: () => void;
}) {
  return (
    <div className="planComposer__routeStale" role="group" aria-labelledby="plan-route-stale-title">
      <div>
        <strong id="plan-route-stale-title">This route needs a refresh</strong>
        <span>{STALE_REASON[cause]}</span>
      </div>
      <button
        type="button"
        className="planComposer__regenerate"
        onClick={onRegenerate}
        disabled={disabled}
        aria-busy={sorting}
      >
        {sorting ? "Refreshing…" : "Regenerate route"}
      </button>
    </div>
  );
}
