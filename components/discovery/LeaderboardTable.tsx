import Link from "next/link";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";

import PriceBadge from "@/components/PriceBadge";
import prefetchVenue from "@/lib/prefetchVenue";
import { priceStandingNote } from "@/lib/priceTier";
import { trustPillLabel } from "@/lib/trustPill";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { formatPrice } from "@/lib/venues";
import type { LeaderboardRowView } from "@/lib/leaderboard";

// Presentational, prop-driven leaderboard. A real semantic <table> (scoped
// column headers, a caption for screen readers) so the ranking reads correctly
// out of context. The price uses the shared stable data badge: tabular numerals,
// fixed width, no stamp tilt. Pub names deep-link to /map?sel=… so Discover
// taps land on the map with that venue selected.
//
// Honesty: these are dataset cheapest-on-record prices, not a live tonight feed
// (contrast TonightBoard). A short footnote keeps that clear without cluttering
// every row, and EVERY ROW WEARS ITS OWN TRUST LABEL beside its figure
// (captain 6 Sep 2026), so the board never claims more than a listing and a
// reader does not have to reach the footnote to learn what a row is worth.
//
// The word is `trustPillLabel`, the ONE place a standing becomes a word, so the
// label here and the label on the landing answer card cannot drift. The pill
// COMPONENT is deliberately not mounted: it prints the figure itself, and the
// figure in this cell is already the PriceBadge above it.

type LeaderboardTableProps = {
  // The narrow row view, not a whole grouped Venue: the ranked rows arrive
  // precomputed (lib/discoverBoard.ts) and carry only what this table prints.
  entries: readonly LeaderboardRowView[];
  caption?: string;
};

const LEADERBOARD_HONESTY =
  "Lowest listed prices on record. Not necessarily tonight's price. Open a pub to see its source and any recent reports.";

export default function LeaderboardTable({
  entries,
  caption = "Listed pint prices in London, cheapest first. Not a live feed.",
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
            <th scope="col" className="leaderboardArea">
              Area
            </th>
            <th scope="col" className="leaderboardPriceHead">
              Cheapest pint
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const href = venueMapUrl(entry.venue.id);
            return (
              <tr key={entry.venue.id} data-reveal>
                <td className="leaderboardRank">
                  <span className="leaderboardRankNum" aria-hidden="true">
                    {entry.rank}
                  </span>
                  <span className="srOnly">Rank {entry.rank}</span>
                </td>
                <th scope="row" className="leaderboardName">
                  <Link prefetch={false}
                    href={href}
                    className="leaderboardPub"
                    onPointerEnter={() => prefetchVenue(entry.venue.id)}
                    onTouchStart={() => prefetchVenue(entry.venue.id)}
                  >
                    {entry.venue.name}
                  </Link>
                  {entry.venue.cheapestPint ? (
                    <span className="leaderboardPint">{entry.venue.cheapestPint}</span>
                  ) : null}
                </th>
                <td className="leaderboardArea">{entry.area}</td>
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
            );
          })}
        </tbody>
      </table>
      <p className="leaderboardHonesty" role="note">
        {LEADERBOARD_HONESTY}
      </p>
    </>
  );
}
