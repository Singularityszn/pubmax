import type { Route } from "next";
import Link from "next/link";

import HandleAvatar from "@/components/profile/HandleAvatar";
import EmptyState from "@/components/ui/empty-state";
import { RowList, RowListItem } from "@/components/ui/row-list";
import Screen from "@/components/ui/screen";
import type { ContributorLeaderboard } from "@/lib/contributorLeaderboard";

function countLabel(total: number): string {
  return total === 1 ? "contribution" : "contributions";
}

/** "3 prices · 1 Visit Report". A lane with nothing in it is left out. */
function laneLine(entry: { prices: number; reviews: number; recommendations: number }): string {
  const lanes: string[] = [];
  if (entry.prices > 0) lanes.push(`${entry.prices} ${entry.prices === 1 ? "price" : "prices"}`);
  if (entry.reviews > 0) lanes.push(`${entry.reviews} ${entry.reviews === 1 ? "Visit Report" : "Visit Reports"}`);
  if (entry.recommendations > 0) {
    lanes.push(
      `${entry.recommendations} ${entry.recommendations === 1 ? "Recommendation" : "Recommendations"}`,
    );
  }
  return lanes.join(" · ");
}

export default function ContributorRecord({
  board,
}: {
  board: ContributorLeaderboard;
}) {
  const thin =
    board.status === "ready" &&
    board.entries.length > 0 &&
    board.entries.length < 4;

  return (
    // The launch head (docs/design/LAUNCH_SCREENS.md): kicker, heading, a
    // short lede and ONE primary, with the map as the quiet way onward. The
    // record's terms are the lede and nothing more: what counts, over what
    // window, and how a tie reads. The rows, or one empty state, sit under it.
    <Screen
      as="section"
      className="contributorRecord"
      kicker="Contributors"
      title="Contributor record"
      titleId="contributor-title"
      lede={
        <>
          Price logs, Visit Reports and Recommendations from public profiles,
          counted over all time. Equal totals share a place.
        </>
      }
      primary={<Link href="/map?log=1">Drop a pint</Link>}
      secondary={<Link href="/map">Open the map</Link>}
    >
      {board.status === "degraded" ? (
        <div role="status">
          <EmptyState title="Record unavailable">
            We could not load the record just now, so no partial totals are
            shown.
          </EmptyState>
        </div>
      ) : board.entries.length === 0 ? (
        <EmptyState title="The record starts with the first pint">
          Log a price with a public profile and it counts here.
        </EmptyState>
      ) : (
        <>
          {thin ? <p className="contributorThin">Early record: a few names so far.</p> : null}
          <RowList label="Contributors by total" className="contributorList">
            {board.entries.map((entry) => (
              <RowListItem
                key={entry.handle}
                className="contributorRow"
                href={`/u/${encodeURIComponent(entry.handle)}` as Route}
                lead={
                  <span className="contributorRank" aria-label={`Rank ${entry.rank}`}>
                    {entry.rank}
                  </span>
                }
                title={
                  <span className="contributorIdentity">
                    <HandleAvatar
                      handle={entry.handle}
                      avatarUrl={entry.avatarUrl}
                      className="contributorAvatar"
                      imageClassName="contributorAvatar"
                      size={32}
                    />
                    <span>@{entry.handle}</span>
                  </span>
                }
                meta={laneLine(entry) || null}
                trailing={
                  <span className="contributorTotal">
                    <strong>{entry.total}</strong>{" "}
                    <span>{countLabel(entry.total)}</span>
                  </span>
                }
              />
            ))}
          </RowList>
        </>
      )}
    </Screen>
  );
}
