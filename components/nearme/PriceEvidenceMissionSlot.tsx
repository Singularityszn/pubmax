"use client";

import { useState } from "react";

import VenuePriceSubmit from "@/components/map/VenuePriceSubmit";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";
import { trackEvent } from "@/lib/analytics";
import type { MissionSurface } from "@/lib/analyticsEvents";
import type { PriceEvidenceMission } from "@/lib/priceEvidenceMissions";
import { missionAnalyticsProps, missionHeading } from "@/lib/priceEvidenceMissions";

import "./priceEvidenceMission.css";

export type PriceEvidenceMissionSlotProps = {
  mission: PriceEvidenceMission;
  venueName: string;
  surface: MissionSurface;
  communityPrices: CommunityPricesState;
  onDismiss: (mission: PriceEvidenceMission) => void;
  /** The logged price answers the ask, so the slot leaves rather than repeating it. */
  onFulfilled?: (mission: PriceEvidenceMission) => void;
  /** Map already mounts the composer; Near opens it on tap. */
  embedComposer?: boolean;
};

export default function PriceEvidenceMissionSlot({
  mission,
  venueName,
  surface,
  communityPrices,
  onDismiss,
  onFulfilled,
  embedComposer = false,
}: PriceEvidenceMissionSlotProps) {
  const [opened, setOpened] = useState(embedComposer);
  // Once this pub's price is logged the ASK is answered, so the heading and
  // its skip go. The composer stays exactly where it is, because the receipt
  // it just printed lives inside this slot.
  const [answered, setAnswered] = useState(false);
  const heading = missionHeading({
    reason: mission.reason,
    venueName,
    drinkCategory: mission.drinkCategory,
  });
  const headingId = `pemHeading-${mission.venueId}`;

  function open(): void {
    setOpened(true);
    trackEvent("mission_opened", missionAnalyticsProps(surface, mission));
  }

  return (
    <section className="pemSlot" aria-labelledby={headingId} data-surface={surface}>
      {answered ? null : (
        <div className="pemHead">
          <h3 id={headingId} className="pemHeading">
            {heading}
          </h3>
          <div className="pemActions">
            {!opened ? (
              <button type="button" className="pemOpen" onClick={open}>
                Log it
              </button>
            ) : null}
            <button
              type="button"
              className="pemSkip"
              onClick={() => onDismiss(mission)}
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {opened ? (
        <VenuePriceSubmit
          venueId={mission.venueId}
          venueName={venueName}
          communityPrices={communityPrices}
          mission={{
            reason: mission.reason,
            drinkCategory: mission.drinkCategory,
            surface,
          }}
          onLogged={(venueId) => {
            if (venueId !== mission.venueId) return;
            setAnswered(true);
            onFulfilled?.(mission);
          }}
        />
      ) : null}
    </section>
  );
}
