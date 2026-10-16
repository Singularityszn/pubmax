"use client";

import type { VenuePlanDoor } from "@/lib/venuePlanDoor";

/**
 * The phone peek's one coral plan door (lib/venuePlanDoor.ts). With no crawl in
 * progress it is `Make it Stop 1`, named for the pub so a screen reader hears
 * which one; with a crawl in progress it is the `Plan stop` / `In plan` toggle.
 */
export default function VenuePeekPlanDoor({
  door,
  venueId,
  venueName,
  onAcceptStop1,
  onToggleStop,
}: {
  door: VenuePlanDoor | null;
  venueId: string;
  venueName: string;
  onAcceptStop1?: () => void;
  onToggleStop: (id: string) => void;
}) {
  if (!door) return null;
  if (door.kind === "stop-1") {
    return (
      <button
        type="button"
        className="mobileVenuePeekPlanDoor"
        data-plan-door="stop-1"
        aria-label={`Make ${venueName} Stop 1`}
        onClick={onAcceptStop1}
      >
        {door.label}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="mobileVenuePeekPlanDoor"
      data-plan-door="crawl"
      aria-pressed={door.inCrawl}
      onClick={() => onToggleStop(venueId)}
    >
      {door.label}
    </button>
  );
}
