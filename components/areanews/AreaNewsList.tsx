// "New round here" — the presentational half of the fresh-facts layer. Pure and
// server-safe (no "use client"): it takes already-resolved entries and renders
// the dated, source-linked list. It renders NOTHING when there are no entries,
// so an area with no facts shows no empty box (the owner's anti-slop rule).
//
// Both the borough chapter page (server component, entries resolved on the
// server) and the map's AreaNewsBlock (client, entries fetched) render through
// this one component, so the block looks identical wherever it appears.

import {
  formatAreaNewsDate,
  KIND_LABEL,
  NEW_ROUND_HERE_CAP,
  type AreaNewsEntry,
} from "@/lib/areaNews";

import "./areaNews.css";

export default function AreaNewsList({
  areaLabel,
  entries,
  cap = NEW_ROUND_HERE_CAP,
  headingId = "areaNewsHeading",
}: {
  /** Human-readable area name for the heading, e.g. "Shoreditch". */
  areaLabel: string;
  entries: AreaNewsEntry[];
  cap?: number;
  headingId?: string;
}) {
  const shown = entries.slice(0, cap);
  if (shown.length === 0) return null;

  return (
    <section className="areaNews" aria-labelledby={headingId}>
      <p className="areaNewsEyebrow">New round here</p>
      <h2 id={headingId} className="areaNewsHeading">
        {areaLabel}, lately
      </h2>
      <ul className="areaNewsList">
        {shown.map((entry) => (
          <li key={entry.id} className="areaNewsItem" data-kind={entry.kind}>
            <div className="areaNewsMeta">
              <span className="areaNewsChip" data-kind={entry.kind}>
                {KIND_LABEL[entry.kind]}
              </span>
              <time className="areaNewsDate" dateTime={entry.observedAt}>
                {formatAreaNewsDate(entry.observedAt)}
              </time>
            </div>
            <p className="areaNewsTitle">{entry.title}</p>
            <p className="areaNewsDetail">{entry.detail}</p>
            <p className="areaNewsSource">
              <a
                href={entry.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="areaNewsSourceLink"
              >
                {entry.sourceName}
              </a>
              {entry.confidence === "social" ? (
                <span className="areaNewsSocial" title="Self-reported sighting, not a checked price">
                  spotted
                </span>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
