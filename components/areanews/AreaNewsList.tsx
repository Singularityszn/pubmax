// "New round here" — the presentational half of the fresh-facts layer. Pure and
// server-safe (no "use client"): it takes already-resolved entries and renders
// the dated, source-linked list or an honest empty state.
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

import styles from "./areaNews.module.css";

export default function AreaNewsList({
  areaLabel,
  entries,
  status = "ready",
  cap = NEW_ROUND_HERE_CAP,
  headingId = "areaNewsHeading",
}: {
  /** Human-readable area name for the heading, e.g. "Shoreditch". */
  areaLabel: string;
  entries: AreaNewsEntry[];
  status?: "ready" | "unavailable";
  cap?: number;
  headingId?: string;
}) {
  const shown = entries.slice(0, cap);

  return (
    <section className={styles.areaNews} aria-labelledby={headingId}>
      <p className={styles.areaNewsEyebrow}>New round here</p>
      <h2 id={headingId} className={styles.areaNewsHeading}>
        {areaLabel}, lately
      </h2>
      {status === "unavailable" ? (
        <p className={styles.areaNewsUnavailable} role="status">
          Area updates are unavailable right now.
        </p>
      ) : shown.length === 0 ? (
        <p className={styles.areaNewsEmpty}>No current updates here.</p>
      ) : (
        <ul className={styles.areaNewsList}>
          {shown.map((entry) => (
            <li key={entry.id} className={styles.areaNewsItem} data-kind={entry.kind}>
              <div className={styles.areaNewsMeta}>
                <span className={styles.areaNewsChip} data-kind={entry.kind}>
                  {KIND_LABEL[entry.kind]}
                </span>
                <time className={styles.areaNewsDate} dateTime={entry.observedAt}>
                  {formatAreaNewsDate(entry.observedAt)}
                </time>
              </div>
              <p className={styles.areaNewsTitle}>{entry.title}</p>
              <p className={styles.areaNewsDetail}>{entry.detail}</p>
              <p className={styles.areaNewsSource}>
                <a
                  href={entry.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={styles.areaNewsSourceLink}
                >
                  {entry.sourceName}
                </a>
                {entry.confidence === "social" ? (
                  <span className={styles.areaNewsSocial} title="Self-reported sighting, not a checked price">
                    spotted
                  </span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
