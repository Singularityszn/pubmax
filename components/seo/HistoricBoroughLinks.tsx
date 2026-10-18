import type { ReactElement } from "react";

import { RowList, RowListItem } from "@/components/ui/row-list";

// "Oldest pubs in {borough}" internal-link rail (Wave S3.4). Server-rendered on
// the Historic hub so crawlers can walk /historic → each borough's cited
// heritage section via plain <a>/<Link> hrefs. Citation-forward: each row names
// the borough's OLDEST cited pub (and its era) — a real, sourced fact lifted
// from the historic dataset, never invented. Only boroughs that resolve to a
// real borough page are linked, so no link 404s.
//
// One list, not a grid of cards with a coral link in each (taste plan, 18 Oct
// 2026): the borough is the row's title and the whole row is its link, so
// `.historicBoroughLink` (the 44px fence in e2e/tap-targets-sweep.spec.ts)
// names the row.

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
      className="historicBoroughRegion listingSection"
      aria-labelledby="historicBoroughHeading"
    >
      <h2 id="historicBoroughHeading" className="listingSectionTitle">
        Oldest pubs by borough
      </h2>
      <p className="listingSectionDek">
        Cited historic pubs, grouped by area. Every date comes from the pub&rsquo;s
        sourced heritage record. Jump to a borough for the full, cited list.
      </p>
      <RowList label="Oldest pubs by borough" className="historicBoroughList listingRead">
        {boroughs.map((row) => (
          <RowListItem
            key={row.slug}
            className="historicBoroughLink"
            href={`/borough/${row.slug}#boroughHeritageHeading`}
            title={row.borough}
            meta={
              <>
                {row.count} cited {row.count === 1 ? "pub" : "pubs"}
                {row.oldestName ? (
                  <>
                    , the oldest is {row.oldestName}
                    {row.oldestEra ? <> ({row.oldestEra})</> : null}
                  </>
                ) : null}
              </>
            }
          />
        ))}
      </RowList>
    </section>
  );
}
