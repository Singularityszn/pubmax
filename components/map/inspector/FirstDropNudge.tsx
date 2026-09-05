import type { ReactNode } from "react";

import { firstDropNudgeCopy } from "@/lib/firstDropNudge";
import { UNPRICED_VENUE_TRUST_LINE } from "@/lib/mapPriceTrust";

/**
 * Unpriced-pub nudge: the honest empty-price line and its trust line. The ONE
 * price door rides in as children, decided by the price area from
 * `overviewPriceDoor` (lib/pintTrust.ts), so this block can never grow a
 * second invitation of its own (it used to carry "Or leave a Pint Drop").
 */
export default function FirstDropNudge({
  venueId,
  children,
}: {
  venueId: string;
  /** The one price door. */
  children?: ReactNode;
}) {
  const copy = firstDropNudgeCopy(venueId);

  return (
    <div className="firstDropNudge" role="note">
      <p className="firstDropNudgeLine">{copy.line}</p>
      <p className="firstDropNudgeTrust">{UNPRICED_VENUE_TRUST_LINE}</p>
      {children}
    </div>
  );
}
