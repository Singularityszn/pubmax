import Link from "next/link";

import HandleAvatar from "@/components/profile/HandleAvatar";
import EmptyState from "@/components/ui/empty-state";
import Screen from "@/components/ui/screen";
import type { ContributorLeaderboard } from "@/lib/contributorLeaderboard";

import styles from "@/app/contributors/Contributors.module.css";

function countLabel(total: number): string {
  return total === 1 ? "contribution" : "contributions";
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
    // The launch head (docs/design/LAUNCH_SCREENS.md): kicker, heading, the
    // record's own terms as the lede, and ONE primary. The window label rides
    // under it as the first line of the record itself.
    <Screen
      as="section"
      className={styles.contributorRecord}
      kicker="Contributors"
      title="Contributor record"
      titleId="contributor-title"
      lede={
        <>
          Price logs, Visit Reports and weather Recommendations, added together.
          Only identity-backed contributions are ranked. Named posts without an
          existing public profile can stay visible elsewhere but sit outside
          this record. Hidden contributions come off the count. Legacy price
          logs without a handle are not ranked. Equal totals share a place.
        </>
      }
      primary={<Link href="/map?log=1">Drop a pint</Link>}
      secondary={<Link href="/map">Open the map</Link>}
    >
      <p className={styles.contributorWindow}>{board.window.label}</p>

      {board.status === "degraded" ? (
        <div role="status">
          <EmptyState title="Record unavailable">
            We couldn&apos;t check the full identity-backed record right now, so
            no partial totals are shown.
          </EmptyState>
        </div>
      ) : board.entries.length === 0 ? (
        <EmptyState title="No identity-backed totals yet">
          Visible named posts can still sit outside this identity-backed
          record when their handle has no existing public profile. Anonymous
          price logs stay off it too.
        </EmptyState>
      ) : (
        <>
          {thin ? (
            <p className={styles.contributorThin}>
              Early record. Visible named posts without an existing public
              profile sit outside this count.
            </p>
          ) : null}
          <ol className={styles.contributorList}>
            {board.entries.map((entry) => (
              <li className={styles.contributorRow} key={entry.handle}>
                <span className={styles.contributorRank} aria-label={`Rank ${entry.rank}`}>
                  {entry.rank}
                </span>
                <div className={styles.contributorIdentity}>
                  <HandleAvatar
                    handle={entry.handle}
                    avatarUrl={entry.avatarUrl}
                    size={36}
                  />
                  <Link href={`/u/${encodeURIComponent(entry.handle)}`}>
                    @{entry.handle}
                  </Link>
                  <dl className={styles.contributorLanes}>
                    <div>
                      <dt>Prices</dt>
                      <dd>{entry.prices}</dd>
                    </div>
                    <div>
                      <dt>Visit Reports</dt>
                      <dd>{entry.reviews}</dd>
                    </div>
                    <div>
                      <dt>Recommendations</dt>
                      <dd>{entry.recommendations}</dd>
                    </div>
                  </dl>
                </div>
                <p className={styles.contributorTotal}>
                  <strong>{entry.total}</strong>{" "}
                  <span>{countLabel(entry.total)}</span>
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </Screen>
  );
}
