"use client";

import { useEffect } from "react";

import { PubPalMascot } from "@/components/pal/PubPalMascot";
import { trackEvent } from "@/lib/analytics";
import { palGenomeFor, palGenomeStyle } from "@/lib/palGenome";
import {
  PAL_QUEST_NO_DRINK,
  palQuestDoneLine,
  palQuestLine,
  type PalQuestStamp as Stamp,
} from "@/lib/palQuest";
import type { PriceEvidenceMissionReason } from "@/lib/priceEvidenceMissions";
import type { PubPal } from "@/lib/pubPal";

import PalQuestStamp from "./PalQuestStamp";
import "./palQuest.css";

// The Pal's price quest on /near: the person's own Pal asks today's price
// evidence mission in its own words, above the mission's own price form
// (components/nearme/NearPriceEvidenceMission.tsx). Answered, the Pal jumps and
// the day's stamp lands. A muted Pal is still; every jump and landing plays
// only when the person allows motion.
export default function PalQuest({
  pal,
  ask,
  done,
}: {
  pal: PubPal;
  ask: { reason: PriceEvidenceMissionReason; venueName: string } | null;
  done: Stamp | null;
}) {
  const genome = palGenomeFor(pal.id, pal.personality);
  // Counted once each time the ask appears, never again while it stays up.
  const asking = !done && ask !== null;
  useEffect(() => {
    if (asking) trackEvent("pal_quest_asked");
  }, [asking]);
  if (!done && !ask) return null;
  return (
    <section
      className="palQuest"
      data-testid="pal-quest"
      data-state={done ? "done" : "ask"}
      data-pal-state={pal.muted ? "sleeping" : undefined}
      aria-live="polite"
    >
      <span className="palQuestFace" aria-hidden="true" style={palGenomeStyle(genome) as React.CSSProperties}>
        <PubPalMascot species={pal.appearance.species} size={48} circular decorative />
      </span>
      <div className="palQuestWords">
        <p className="palQuestLine">
          {done ? palQuestDoneLine(pal.name, done.venueName) : palQuestLine(pal.name, ask!.reason, ask!.venueName)}
        </p>
        {done ? null : <p className="palQuestSmall">{PAL_QUEST_NO_DRINK}</p>}
      </div>
      {done ? <PalQuestStamp stamp={done} print={genome.print} fresh /> : null}
    </section>
  );
}
