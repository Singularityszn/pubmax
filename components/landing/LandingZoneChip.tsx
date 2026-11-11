import { anchorZoneChip } from "@/lib/landingHero";
import type { LandingCardStation } from "@/lib/landingPubCard";

import "./landingZoneChip.css";

// The anchor card's zone chip: four fare-zone rings closing on a centre dot, then
// the zone and the station it comes from. The rings are a drawing, not a map:
// fare zones belong to stations, and the words beside them say which one.

const RINGS = [9.25, 7.5, 5.75, 4] as const;

export default function LandingZoneChip({ station }: { station: LandingCardStation }) {
  const chip = anchorZoneChip(station);
  return (
    <span className="lpZoneChip" aria-label={chip.label} data-testid="landing-zone-chip">
      <svg className="lpZoneMark" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
        {RINGS.map((r, i) => (
          <circle key={r} className="lpZoneRing" style={{ ["--ring" as string]: i }} cx="10" cy="10" r={r} />
        ))}
        <circle className="lpZoneCore" cx="10" cy="10" r="2.25" />
      </svg>
      <span aria-hidden="true">{chip.text}</span>
    </span>
  );
}
