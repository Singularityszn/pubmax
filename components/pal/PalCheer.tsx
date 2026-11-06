"use client";

import { PubPalMascot } from "@/components/pal/PubPalMascot";
import { useOwnPal } from "@/components/pal/useOwnPal";
import { palGenomeFor, palGenomeStyle } from "@/lib/palGenome";
import type { PalMomentKind } from "@/lib/palMoments";
import "./palCheer.css";

/** The line the Pal says for a moment: what happened, never a score. */
export function palCheerLine(name: string, moment: PalMomentKind, stops = 0): string {
  if (moment === "price-added") return `${name} says thanks. Every price helps the next person.`;
  if (moment === "night-finished") return `${name} saw the whole night through with you.`;
  return stops > 1 ? `${name} walked all ${stops} stops with you.` : `${name} walked it with you.`;
}

// The person's own Pal, jumping for joy inside a celebration (the crawl's
// "You walked it", a planned night's ending, a kept price). It is the same rendered avatar,
// held by the Pal's genome; a hidden Pal, or none, shows nothing. It jumps once
// and only when the person allows motion; a muted Pal is still.
export default function PalCheer({ moment, stops }: { moment: PalMomentKind; stops?: number }) {
  const pal = useOwnPal();
  if (!pal) return null;
  const genome = palGenomeFor(pal.id, pal.personality);
  return (
    <div className="palCheer" data-testid="pal-cheer" data-pal-state={pal.muted ? "sleeping" : undefined}>
      <span className="palCheerFace" aria-hidden="true" style={palGenomeStyle(genome) as React.CSSProperties}>
        <PubPalMascot species={pal.appearance.species} size={56} circular decorative className="palCheerImg" />
        <span className="palCheerSparks">
          {Array.from({ length: 8 }, (_, index) => (
            <i key={index} style={{ "--spark": index } as React.CSSProperties} />
          ))}
        </span>
      </span>
      <p className="palCheerLine">{palCheerLine(pal.name, moment, stops)}</p>
    </div>
  );
}
