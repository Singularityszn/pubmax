import { useEffect } from "react";
import { PlusCircle } from "lucide-react";

import { firstDropNudgeCopy } from "@/lib/firstDropNudge";

/**
 * First-drop nudge (Cycle-8 item 3). Rendered in the overview price area ONLY
 * when the venue has no price on any honest source (see isVenueUnpriced). It
 * turns the empty price slot into a dry, London-toned invitation to log the
 * first Pint Drop for this pub — one line + one CTA, never a banner.
 *
 * The CTA opens the EXISTING Pint Drop composer prefilled for this venue via
 * the onStartFirstDrop seam (VenueInspector wires it to selectTab("pints") +
 * setComposerOpen(true) — the composer is per-venue by its venueId prop). This
 * component owns no composer state and no #303/#315 dependency: it renders
 * wherever an unpriced venue's overview renders.
 */
export default function FirstDropNudge({
  venueId,
  venueName,
  onStartFirstDrop,
}: {
  venueId: string;
  venueName: string;
  onStartFirstDrop: () => void;
}) {
  const copy = firstDropNudgeCopy(venueId);

  useEffect(() => {
    // POST-#301: analytics beacon lands once the first_drop_nudge_shown event is
    // registered in lib/analyticsEvents.ts (no registry edits on this branch).
    //   trackEvent("first_drop_nudge_shown", { venueId });
  }, [venueId]);

  return (
    <div className="firstDropNudge" role="note">
      <p className="firstDropNudgeLine">{copy.line}</p>
      {/* POST-#303: when the drop-streak lands, the contributor's "your streak"
          line goes here — e.g. "Day 3 — keep it going." Kept out until #303 so
          the nudge never promises a streak that doesn't exist yet. */}
      <button
        type="button"
        className="firstDropNudgeCta"
        onClick={() => {
          // POST-#301: analytics beacon lands once first_drop_nudge_tapped is
          // registered in lib/analyticsEvents.ts (no registry edits on this
          // branch).
          //   trackEvent("first_drop_nudge_tapped", { venueId });
          onStartFirstDrop();
        }}
        aria-label={`Log the first Pint Drop at ${venueName}`}
      >
        <PlusCircle size={15} aria-hidden="true" /> {copy.cta}
      </button>
    </div>
  );
}
