"use client";

import { useId } from "react";

import { ACTION_CARD_CORAL_CLASS } from "@/lib/venueActionCard";
import { LOG_WHAT_YOU_PAID_LABEL } from "@/lib/venuePlanDoor";

import "./venueLogDoor.css";

/**
 * The card's coral when the pub has no drinker price from the last 30 days
 * (lib/venuePlanDoor.ts, `venueSheetDoors`). It opens the Pint Drop composer,
 * the same one /map?log=1 opens. The glass fills as the button is pressed.
 */
export default function VenueLogDoor({
  venueName,
  onLog,
}: {
  venueName: string;
  onLog: () => void;
}) {
  const clipId = useId();
  return (
    <button
      type="button"
      className={`${ACTION_CARD_CORAL_CLASS} venueLogDoor`}
      data-log-door=""
      aria-label={`${LOG_WHAT_YOU_PAID_LABEL} at ${venueName}`}
      onClick={onLog}
    >
      <svg className="venueLogDoorGlass" viewBox="0 0 20 24" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={clipId}>
            <path d="M3.6 3h12.8l-1.5 18H5.1z" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <rect className="venueLogDoorBeer" x="0" y="3" width="20" height="21" />
        </g>
        <path className="venueLogDoorOutline" d="M3 2h14l-1.6 20H4.6z" />
      </svg>
      <span>{LOG_WHAT_YOU_PAID_LABEL}</span>
    </button>
  );
}
