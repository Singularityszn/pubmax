"use client";

import { Route } from "lucide-react";

import type { VenuePlanDoor } from "@/lib/venuePlanDoor";

/**
 * The sheet's one plan door (lib/venuePlanDoor.ts). With no crawl in progress
 * it is `Make it Stop 1`, named for the pub so a screen reader hears which
 * one; with a crawl in progress it is the `Plan stop` / `In plan` toggle.
 *
 * `coral` is the card's painted door in its first row. `ghost` is the same
 * door in the card's action row, beside "Ask for a table", when the coral asks
 * for a price instead.
 */
export default function VenuePeekPlanDoor({
  door,
  venueId,
  venueName,
  onAcceptStop1,
  onToggleStop,
  tone = "coral",
}: {
  door: VenuePlanDoor | null;
  venueId: string;
  venueName: string;
  onAcceptStop1?: () => void;
  onToggleStop: (id: string) => void;
  tone?: "coral" | "ghost";
}) {
  if (!door) return null;
  const className = tone === "ghost" ? "venueSheetStickyGhost" : "mobileVenuePeekPlanDoor";
  const icon = tone === "ghost" ? <Route size={16} aria-hidden="true" /> : null;
  if (door.kind === "stop-1") {
    return (
      <button
        type="button"
        className={className}
        data-plan-door="stop-1"
        aria-label={`${door.label}: ${venueName}`}
        onClick={onAcceptStop1}
      >
        {icon}
        {door.label}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={className}
      data-plan-door="crawl"
      aria-pressed={door.inCrawl}
      onClick={() => onToggleStop(venueId)}
    >
      {icon}
      {door.label}
    </button>
  );
}
