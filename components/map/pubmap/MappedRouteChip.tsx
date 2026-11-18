import { Footprints, Route as RouteIcon, TrainFront, X } from "lucide-react";
import type { CuratedWalk } from "@/lib/curatedWalk";

// Presentational "N stops mapped" chip with edit / last-train / hide actions.
// Global CSS (mappedRouteChip) is already imported by PubMap. Extracted
// verbatim from PubMap (F1); the routeMappedActive guard stays in PubMap.
export function MappedRouteChip({
  stopCount,
  totalKm,
  totalMinutes,
  onEdit,
  onCheckLastTrain,
  onHide,
  walk,
}: {
  stopCount: number;
  totalKm: number;
  totalMinutes: number;
  onEdit: () => void;
  onCheckLastTrain: () => void;
  onHide: () => void;
  walk?: CuratedWalk;
}) {
  return (
    // An exempt surface of the desktop venue drawer's focus trap
    // (lib/useFocusTrap.ts): the chip stays pressable while a pub is open.
    <div
      className="mappedRouteChip"
      role="status"
      aria-live="polite"
      data-focus-trap-exempt=""
    >
      <RouteIcon size={16} aria-hidden="true" />
      <div>
        <strong>{stopCount} stops</strong>
        <span>
          <Footprints size={14} aria-hidden="true" />
          Approx. {totalKm.toFixed(1)} km · {totalMinutes} min walk
        </span>
      </div>
      <button type="button" onClick={onEdit}>
        {walk ? "View stops" : "Edit stops"}
      </button>
      {!walk ? <button
        type="button"
        onClick={onCheckLastTrain}
        aria-label="Check last train at final stop"
        title="Last train"
      >
        <TrainFront size={14} aria-hidden="true" />
      </button> : null}
      <button type="button" onClick={onHide} aria-label="Hide mapped crawl">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
