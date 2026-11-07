import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import { HUNT_HERO_TITLE, huntSourceVerb, type HuntPint } from "@/lib/cheapestHunt";
import { formatObservedDate } from "@/lib/dataFreshness";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { formatPrice } from "@/lib/venues";

// The first thing the front door shows (captain decisions 2 and 3, 1 Nov
// 2026): the cheapest pint found across the UK cities on our map, with the pub, the
// price, who listed it and the day that source was read. It replaced the stock
// photograph of Tower Bridge.
//
// A SERVER COMPONENT, AND IT STAYS ONE. app/page.tsx renders it at prerender and
// hands the finished element to the client hero as a slot, so the card costs
// the landing no JavaScript at all (perf/route-budgets.json). Nothing here may
// take a hook or an event handler.
//
// NO JOKE IN SIGHT OF THE FIGURE (docs/VOICE.md, "Where the jokes live"). The
// heading sets the scope; the figure line and the source line say
// what the data says and nothing more. lib/cheapestHunt.ts decides the winner,
// so this file only prints it: an estimate can never reach it.

/** "21 September 2026", a source read or observation day. */
function huntReadDay(observedOn: string): string {
  return formatObservedDate(new Date(`${observedOn}T12:00:00.000Z`));
}

/** Date the evidence beside the amount. A read is not a new observation at the bar. */
export function HuntSource({
  pint,
  className,
  showCurrentPriceNote = false,
}: {
  pint: HuntPint;
  className: string;
  showCurrentPriceNote?: boolean;
}) {
  return (
    <p className={className}>
      {pint.standing === "confirmed" ? "Price observed" : "Source read"}{" "}
      <time dateTime={pint.observedOn}>{huntReadDay(pint.observedOn)}</time>.{" "}
      {huntSourceVerb(pint.standing)}{" "}
      <a href={pint.publisher.url} target="_blank" rel="noopener noreferrer">
        {pint.publisher.label}
      </a>
      .{showCurrentPriceNote ? " Current price may differ." : null}
    </p>
  );
}

/** The figure stamp, wearing its band and no other colour (lib/priceBand.ts). */
export function HuntPrice({ pint }: { pint: HuntPint }) {
  return (
    <PriceBadge variant="current" band={priceBand(pint.priceGbp, priceBandAreaForVenue(pint.venueId))}>
      {formatPrice(pint.priceGbp)}
    </PriceBadge>
  );
}

export default function LandingHuntCard({ pint }: { pint: HuntPint | null }) {
  // No pint that may win: no card, never an invented one.
  if (!pint) return null;
  return (
    <article className="lpHuntCard" aria-labelledby="lp-hunt-title" data-testid="landing-hunt-card">
      <h2 className="lpHuntTitle" id="lp-hunt-title">
        {HUNT_HERO_TITLE}
      </h2>
      <p className="lpHuntFigure" data-testid="landing-hunt-figure">
        <HuntPrice pint={pint} />
        <span className="lpHuntWhere">
          a pint at{" "}
          <Link prefetch={false} href={pint.mapHref}>
            {pint.pubName}
          </Link>
          , {pint.placeName}
        </span>
      </p>
      <HuntSource pint={pint} className="lpHuntSource" showCurrentPriceNote />
    </article>
  );
}
