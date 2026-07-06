import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { formatPrice } from "@/lib/venues";
import type { ThenVsNowItem } from "@/lib/thenVsNow";

// A single "Then vs Now" price card: the pub name (linked into /map?sel=…), a
// "Then" baseline stamp from the dataset next to a "Now" community stamp, and
// the delta between them (↑ rust for dearer, ↓ sober-green for cheaper). Purely
// presentational and prop-driven — the /discover page computes the item and owns
// the fetch. The "Now" price is community-reported, so it is labelled honestly
// (not authoritative).

type ThenVsNowCardProps = {
  item: ThenVsNowItem;
};

// Round to the penny for the direction test so a £0.004 float wobble never
// paints a "went up" arrow on what is effectively no change.
function direction(deltaGbp: number): "up" | "down" | "flat" {
  const pennies = Math.round(deltaGbp * 100);
  if (pennies > 0) return "up";
  if (pennies < 0) return "down";
  return "flat";
}

export default function ThenVsNowCard({ item }: ThenVsNowCardProps) {
  const dir = direction(item.deltaGbp);
  const abs = Math.abs(item.deltaGbp);
  const pctAbs = Math.abs(item.pct);
  const href = `/map?sel=${encodeURIComponent(item.venueId)}`;

  // A screen-reader sentence that reads the movement plainly, out of context.
  const movementLabel =
    dir === "flat"
      ? `No change from the ${formatPrice(item.thenGbp)} baseline.`
      : `${dir === "up" ? "Up" : "Down"} ${formatPrice(abs)} (${pctAbs.toFixed(
          0,
        )}%) from the ${formatPrice(item.thenGbp)} baseline, community-reported.`;

  const DirIcon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;

  return (
    <article className="tvnCard">
      <h3 className="tvnName">
        <Link href={href} className="tvnLink">
          {item.venueName}
        </Link>
      </h3>

      <div className="tvnStamps">
        <div className="tvnStampGroup">
          <span className="tvnStampLabel">Then</span>
          <span className="tvnStamp tvnStampThen">{formatPrice(item.thenGbp)}</span>
        </div>
        <span className="tvnArrow" aria-hidden="true">
          →
        </span>
        <div className="tvnStampGroup">
          <span className="tvnStampLabel">Now</span>
          <span className="tvnStamp tvnStampNow">{formatPrice(item.nowGbp)}</span>
        </div>
      </div>

      <p className={`tvnDelta tvnDelta-${dir}`}>
        <DirIcon size={15} aria-hidden="true" />
        <span aria-hidden="true">
          {dir === "flat"
            ? "No change"
            : `${dir === "up" ? "+" : "−"}${formatPrice(abs)} (${pctAbs.toFixed(0)}%)`}
        </span>
        <span className="srOnly">{movementLabel}</span>
      </p>

      <p className="tvnFootnote">Then = dataset baseline · Now = community-reported</p>
    </article>
  );
}
