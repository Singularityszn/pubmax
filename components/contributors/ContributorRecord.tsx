import Link from "next/link";

import type { ContributorLeaderboard } from "@/lib/contributorLeaderboard";

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
    <section className="contributorRecord" aria-labelledby="contributor-title">
      <header className="contributorHead">
        <p className="contributorEyebrow">Public record</p>
        <h1 id="contributor-title">Contributor record</h1>
        <p className="contributorLede">
          Price logs, Visit Reports and weather Recommendations, added together.
          Hidden contributions come off the count. Anonymous price logs are not
          ranked. Equal totals share a place.
        </p>
        <p className="contributorWindow">{board.window.label}</p>
      </header>

      {board.status === "degraded" ? (
        <div className="contributorState" role="status">
          <h2>Record unavailable</h2>
          <p>
            We couldn&apos;t check the full record right now, so no partial
            totals are shown.
          </p>
        </div>
      ) : board.entries.length === 0 ? (
        <div className="contributorState">
          <h2>The ledger is open</h2>
          <p>
            First public names land here as attributed prices, Visit Reports
            and Recommendations are published. Anonymous price logs stay off
            this record.
          </p>
        </div>
      ) : (
        <>
          {thin ? (
            <p className="contributorThin">
              Early record. Every visible contribution counts.
            </p>
          ) : null}
          <ol className="contributorList">
            {board.entries.map((entry) => (
              <li className="contributorRow" key={entry.handle}>
                <span className="contributorRank" aria-label={`Rank ${entry.rank}`}>
                  {entry.rank}
                </span>
                <div className="contributorIdentity">
                  <Link href={`/u/${encodeURIComponent(entry.handle)}`}>
                    @{entry.handle}
                  </Link>
                  <dl className="contributorLanes">
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
                <p className="contributorTotal">
                  <strong>{entry.total}</strong>{" "}
                  <span>{countLabel(entry.total)}</span>
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
