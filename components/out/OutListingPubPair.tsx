import Link from "next/link";

import PubmaxxMark from "@/components/brand/PubmaxxMark";
import {
  OUT_LISTING_VENUE_BADGE_LABEL,
  outListingPubPair,
} from "@/lib/outDesktopGrouping";
import type { WhatsOnRow } from "@/lib/whatsOn";

type OutListingPubPairProps = {
  row: WhatsOnRow;
};

/**
 * The pub beside a listing, or the honest absence of one.
 *
 * An absent pub used to render nothing at all, and the count of those rows was
 * the whole page. It is a footnote on the row now: the listing is real either
 * way, and the only thing missing is a pin of ours.
 */
export function OutListingPubPair({ row }: OutListingPubPairProps) {
  const pair = outListingPubPair(row);
  if (pair.status === "absent") {
    return (
      <p className="outListingPubPair outListingPubPair--absent">{pair.line}</p>
    );
  }
  return (
    <div className="outListingPubPair outListingPubPair--matched">
      <div className="outListingPubPairHead">
        {/* duo, never mono: the Crossing X in a single ink colour at 18px is
            indistinguishable from another company's logo, and it sat one line
            under a Ticketmaster credit. Coral plus the lit ember is ours and
            reads as ours, beside a label that is already coral. */}
        <PubmaxxMark variant="duo" size={20} aria-hidden="true" />
        <span className="outListingPubPairLabel">{OUT_LISTING_VENUE_BADGE_LABEL}</span>
      </div>
      <p className="outListingPubPairName">{pair.placeName}</p>
      <Link className="outListingPubPairLink pressable" href={pair.mapHref}>
        Open on map
      </Link>
    </div>
  );
}
