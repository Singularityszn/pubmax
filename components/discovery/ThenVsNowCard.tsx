import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import PriceBadge from "@/components/PriceBadge";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { formatPrice } from "@/lib/venues";
import { DRINK_MEASURE_LABEL } from "@/lib/drinkMeasure";
import type { ThenVsNowItem } from "@/lib/thenVsNow";

// A single "Then vs Now" price card: the pub name (linked into /map?sel=…), a
// compact baseline price next to the freshest community price, and the delta
// between them (↑ rust for dearer, ↓ sober-green for cheaper). Purely
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
  const comparable = item.deltaGbp !== null && item.pct !== null;
  const dir = direction(item.deltaGbp ?? 0);
  const abs = Math.abs(item.deltaGbp ?? 0);
  const pctAbs = Math.abs(item.pct ?? 0);
  const href = venueMapUrl(item.venueId);

  // A screen-reader sentence that reads the movement plainly, out of context.
  const movementLabel =
    dir === "flat"
      ? `No change from the earlier ${formatPrice(item.thenGbp)} price.`
      : `${dir === "up" ? "Up" : "Down"} ${formatPrice(abs)} (${pctAbs.toFixed(
          0,
        )}%) from the earlier ${formatPrice(item.thenGbp)} price, community-reported.`;

  const DirIcon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;

  const observation = (drink: string, measure: keyof typeof DRINK_MEASURE_LABEL | null, date: string | null) => {
    const time = date ? Date.parse(date) : NaN;
    const dated = Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : "Date not recorded";
    return `${drink || "Drink not recorded"} · ${measure ? DRINK_MEASURE_LABEL[measure] : "Serving not recorded"} · ${dated}`;
  };

  return (
    <article className="tvnCard" data-reveal>
      <h3 className="tvnName">
        <Link prefetch={false} href={href} className="tvnLink">
          {item.venueName}
        </Link>
      </h3>

      <div className="tvnCompareRow">
        <div className="tvnPriceGroup">
          <span className="tvnPriceLabel">Earlier observation</span>
          <span>{observation(item.thenDrink, item.thenMeasure, item.thenObservedAt)}</span>
          <PriceBadge variant="baseline">{formatPrice(item.thenGbp)}</PriceBadge>
        </div>
        <span className="tvnArrow" aria-hidden="true">
          →
        </span>
        <div className="tvnPriceGroup">
          <span className="tvnPriceLabel">Community observation</span>
          <span>{observation(item.nowDrink, item.nowMeasure, item.nowObservedAt)}</span>
          <PriceBadge variant={dir === "up" ? "increase" : "current"}>
            {formatPrice(item.nowGbp)}
          </PriceBadge>
        </div>
      </div>

      {comparable ? <p className={`tvnDelta tvnDelta-${dir}`}>
        <DirIcon size={15} aria-hidden="true" />
        <span aria-hidden="true">
          {dir === "flat"
            ? "No change"
            : `${dir === "up" ? "+" : "−"}${formatPrice(abs)} (${pctAbs.toFixed(0)}%)`}
        </span>
        <span className="srOnly">{movementLabel}</span>
      </p> : <p className="tvnDelta">Different or unrecorded drinks or servings. No price-change comparison.</p>}
    </article>
  );
}
