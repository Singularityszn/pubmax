import Link from "next/link";

import { formatPrice } from "@/lib/venues";
import type { TonightEntry } from "@/lib/leaderboard";

// "Cheapest pints logged tonight" — a live, community-driven board of the
// cheapest Pint Drops reported in the trailing 24h (PRD §5.1). Purely
// presentational and prop-driven: the /discover page computes the entries from
// the community drops it already fetches and owns the data lifecycle. Each row
// is one venue's cheapest reported pint: the rank, the pub (linked into
// /map?sel=…), the £ price stamp, the reporter's @handle, and a rough relative
// time. Prices are community-reported — labelled honestly, not authoritative.

type TonightBoardProps = {
  entries: TonightEntry[];
  caption?: string;
};

// Whole-number "n ago" relative time — matches the feed card's format. Every
// tonight entry is inside 24h so this only ever lands in the just-now/m/h band,
// but the fuller ladder is kept so a clock skew can't produce a broken label.
// Called only in render off a stable createdAt (no live ticking) so server and
// first client render agree — no hydration mismatch.
function relativeTime(createdAt: string): string {
  const then = Date.parse(createdAt);
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function TonightBoard({
  entries,
  caption = "Cheapest pints logged by the community in the last 24 hours, cheapest first.",
}: TonightBoardProps) {
  if (entries.length === 0) {
    return (
      <p className="discoverEmpty" role="status">
        No pints logged in the last 24h — <Link href="/map">be the first tonight</Link>.
      </p>
    );
  }

  return (
    <ol className="tonightBoard" aria-label={caption}>
      {entries.map((entry) => {
        const ago = relativeTime(entry.createdAt);
        const href = `/map?sel=${encodeURIComponent(entry.venueId)}`;
        return (
          <li key={entry.venueId} className="tonightRow">
            <span className="tonightRank" aria-hidden="true">
              {entry.rank}
            </span>
            <span className="srOnly">Rank {entry.rank}</span>

            <span className="tonightMain">
              <Link href={href} className="tonightPub">
                {entry.venueName}
              </Link>
              <span className="tonightMeta">
                {entry.handle ? (
                  <span className="tonightHandle">@{entry.handle}</span>
                ) : (
                  <span className="tonightHandle tonightHandleAnon">anon</span>
                )}
                {ago ? (
                  <>
                    <span className="tonightDot" aria-hidden="true">
                      ·
                    </span>
                    <time className="tonightAgo" dateTime={entry.createdAt}>
                      {ago}
                    </time>
                  </>
                ) : null}
              </span>
            </span>

            <span className="priceStamp tonightPrice">{formatPrice(entry.priceGbp)}</span>
          </li>
        );
      })}
    </ol>
  );
}
