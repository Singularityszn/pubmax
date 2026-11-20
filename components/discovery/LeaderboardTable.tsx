import Link from "next/link";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";

import PriceBadge from "@/components/PriceBadge";
import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import type { DiscoverBoardRow } from "@/lib/discoverBoard";
import prefetchVenue from "@/lib/prefetchVenue";
import { priceStandingNote } from "@/lib/priceTier";
import { trustPillLabel } from "@/lib/trustPill";
import { formatPrice } from "@/lib/venues";
import type { Route } from "next";

type LeaderboardTableProps = {
  entries: readonly DiscoverBoardRow[];
  caption?: string;
};

const LEADERBOARD_HONESTY = "Not necessarily tonight's price.";

export default function LeaderboardTable({
  entries,
  caption = "Pint prices in London, cheapest first. Not a live feed.",
}: LeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <p className="discoverEmpty" role="status">
        No priced pints to rank yet. The table fills in as prices come in.
      </p>
    );
  }

  return (
    <>
      <table className="leaderboard">
        <caption className="srOnly">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="leaderboardRank">
              #
            </th>
            <th scope="col">Pub</th>
            <th scope="col" className="leaderboardPriceHead">
              Cheapest pint
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.venue.id} data-reveal>
              <td className="leaderboardRank">
                <span className="leaderboardRankNum" aria-hidden="true">
                  {entry.rank}
                </span>
                <span className="srOnly">Rank {entry.rank}</span>
              </td>
              <th scope="row" className="leaderboardName">
                <Link prefetch={false}
                  href={entry.mapHref as Route}
                  className="leaderboardPub"
                  onPointerEnter={() => prefetchVenue(entry.venue.id)}
                  onTouchStart={() => prefetchVenue(entry.venue.id)}
                >
                  {entry.venue.name}
                </Link>
                <span className="leaderboardPint">{entry.area}</span>
                {entry.venue.cheapestPint ? (
                  <span className="leaderboardPint">{entry.venue.cheapestPint}</span>
                ) : null}
                <span className="leaderboardPint leaderboardEvidence">
                  <a href={entry.publisher.url} target="_blank" rel="noreferrer">{entry.publisher.label}</a>
                  {" · "}
                  <time dateTime={entry.observedAt}>{formatObservedDate(new Date(entry.observedAt))}</time>
                </span>
              </th>
              <td className="leaderboardPriceHead">
                <PriceBadge
                  variant="cheap"
                  band={priceBand(entry.venue.cheapestPrice, priceBandAreaForVenue(entry.venue.id))}
                >
                  {formatPrice(entry.venue.cheapestPrice)}
                </PriceBadge>
                <span
                  className="leaderboardStanding"
                  data-standing={entry.standing}
                  title={priceStandingNote(entry.standing)}
                >
                  {trustPillLabel(entry.standing)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="leaderboardHonesty" role="note">
        {LEADERBOARD_HONESTY}
      </p>
    </>
  );
}
