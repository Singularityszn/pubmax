import type { ReactElement } from "react";
import Link from "next/link";
import styles from "@/app/historic/Historic.module.css";

// "Oldest pubs in {borough}" internal-link rail (Wave S3.4). Server-rendered on
// the Historic hub so crawlers can walk /historic → each borough's cited
// heritage section via plain <a>/<Link> hrefs. Citation-forward: each row names
// the borough's OLDEST cited pub (and its era) — a real, sourced fact lifted
// from the historic dataset, never invented. Only boroughs that resolve to a
// real borough page are linked, so no link 404s.

export type HistoricBoroughLink = {
  slug: string;
  borough: string;
  count: number;
  oldestName: string | null;
  oldestEra: string | null;
};

export default function HistoricBoroughLinks({
  boroughs,
}: {
  boroughs: HistoricBoroughLink[];
}): ReactElement | null {
  if (boroughs.length === 0) return null;

  return (
    <section
      className={styles.historicBoroughRegion}
      aria-labelledby="historicBoroughHeading"
    >
      <h2 id="historicBoroughHeading" className={styles.historicBoroughTitle}>
        Oldest pubs by borough
      </h2>
      <p className={styles.historicBoroughDek}>
        Cited historic pubs, grouped by area. Every date comes from the pub&rsquo;s
        sourced heritage record. Jump to a borough for the full, cited list.
      </p>
      <ul className={styles.historicBoroughList}>
        {boroughs.map((row) => (
          <li key={row.slug} className={styles.historicBoroughCard}>
            <Link
              className={styles.historicBoroughLink}
              href={`/borough/${row.slug}#boroughHeritageHeading`}
            >
              Oldest pubs in {row.borough}
            </Link>
            <p className={styles.historicBoroughMeta}>
              {row.count} cited {row.count === 1 ? "pub" : "pubs"}
              {row.oldestName ? (
                <>
                  {" "}
                  &middot; oldest is {row.oldestName}
                  {row.oldestEra ? <> ({row.oldestEra})</> : null}
                </>
              ) : null}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
