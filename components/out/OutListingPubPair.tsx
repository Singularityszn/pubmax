import Link from "next/link";

import PubmaxxMark from "@/components/brand/PubmaxxMark";
import { outListingPubPair } from "@/lib/outDesktopGrouping";
import type { WhatsOnRow } from "@/lib/whatsOn";

type OutListingPubPairProps = {
  row: WhatsOnRow;
};

export function OutListingPubPair({ row }: OutListingPubPairProps) {
  const pair = outListingPubPair(row);
  if (pair.status === "absent") {
    return <span className="srOnly">{pair.line}</span>;
  }
  return (
    <div className="outListingPubPair outListingPubPair--matched">
      <div className="outListingPubPairHead">
        <PubmaxxMark variant="mono" size={18} aria-hidden="true" />
        <span className="outListingPubPairLabel">PUBMAXX pub</span>
      </div>
      <p className="outListingPubPairName">{pair.placeName}</p>
      <Link className="outListingPubPairLink pressable" href={pair.mapHref}>
        Open on map
      </Link>
    </div>
  );
}
