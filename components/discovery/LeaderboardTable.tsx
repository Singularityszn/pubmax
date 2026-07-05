import { formatPrice } from "@/lib/venues";
import type { LeaderboardEntry } from "@/lib/leaderboard";

// Presentational, prop-driven leaderboard. A real semantic <table> (scoped
// column headers, a caption for screen readers) so the ranking reads correctly
// out of context. The price is rendered as a "stamp" — a small pressed badge —
// but stays plain text for assistive tech.

type LeaderboardTableProps = {
  entries: LeaderboardEntry[];
  caption?: string;
};

export default function LeaderboardTable({
  entries,
  caption = "Cheapest pints in London, cheapest first.",
}: LeaderboardTableProps) {
  if (entries.length === 0) {
    return (
      <p className="discoverEmpty" role="status">
        No priced pints to rank just yet — check back once the taps report in.
      </p>
    );
  }

  return (
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
        {entries.map((entry) => (
          <tr key={entry.venue.id}>
            <td className="leaderboardRank">
              <span className="leaderboardRankNum" aria-hidden="true">
                {entry.rank}
              </span>
              <span className="srOnly">Rank {entry.rank}</span>
            </td>
            <th scope="row" className="leaderboardName">
              <span className="leaderboardPub">{entry.venue.name}</span>
              {entry.venue.cheapestPint ? (
                <span className="leaderboardPint">{entry.venue.cheapestPint}</span>
              ) : null}
            </th>
            <td className="leaderboardArea">{entry.area}</td>
            <td className="leaderboardPriceHead">
              <span className="priceStamp">{formatPrice(entry.venue.cheapestPrice)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
