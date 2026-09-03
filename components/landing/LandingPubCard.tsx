import Link from "next/link";

import PriceBadge from "@/components/PriceBadge";
import Kicker from "@/components/ui/kicker";
import type { LandingPubCardData } from "@/lib/landingPubCard";
import { formatObservedDay, formatObservedMonth } from "@/lib/priceHistory";
import { PRICE_STANDING_TONE, priceStandingLabel, priceStandingNote } from "@/lib/priceTier";
import { formatPrice } from "@/lib/venues";

// One real pub, above the fold. Every line is a fact with its source beside
// it: the listed price and who listed it, the day the dataset was collected,
// and one dated archive price with a link a reader can check. The standing
// chip is the PriceStanding lib/priceTier.ts decided for the row: a published
// price inside its window reads Listed, never Confirmed, because a prerendered
// document cannot know what a drinker did after the build. The primary action
// beside the card is how it turns green.

const LONDON_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/London",
});

function collectedDay(iso: string): string {
  const ms = Date.parse(`${iso}T12:00:00.000Z`);
  return Number.isFinite(ms) ? LONDON_DAY.format(new Date(ms)) : iso;
}

export default function LandingPubCard({ card }: { card: LandingPubCardData }) {
  return (
    <article className="lpPubCard" aria-labelledby="lp-pub-name">
      <Kicker tone="muted">{card.area}</Kicker>
      <h2 className="lpPubName" id="lp-pub-name">
        <Link prefetch={false} href={card.mapHref}>
          {card.name}
        </Link>
      </h2>
      <p className="lpPubPrice">
        <PriceBadge variant="current">{formatPrice(card.priceGbp)}</PriceBadge>
        <span className="lpPubPint">{card.pintName}</span>
      </p>
      <p className="lpPubSource">
        {card.publisher ? (
          <>
            Listed by{" "}
            <a href={card.publisher.url} target="_blank" rel="noopener noreferrer">
              {card.publisher.label}
            </a>
          </>
        ) : (
          "No publisher recorded"
        )}
        , collected {collectedDay(card.collectedOn)}.
      </p>
      <span
        className={`lpStanding lpStanding-${PRICE_STANDING_TONE[card.standing]}`}
        data-standing={card.standing}
        title={priceStandingNote(card.standing)}
      >
        <span className="lpStandingDot" aria-hidden="true" />
        {priceStandingLabel(card.standing)}
      </span>
      <p className="lpPubThen">
        <strong>{formatPrice(card.then.priceGbp)}</strong> in {formatObservedMonth(card.then.observedOn)}.{" "}
        {card.movementLine}
      </p>
      <p className="lpPubThenSource">
        <a href={card.then.source.url} target="_blank" rel="noopener noreferrer">
          {card.then.source.label}
        </a>
        , {formatObservedDay(card.then.observedOn)}
      </p>
    </article>
  );
}
