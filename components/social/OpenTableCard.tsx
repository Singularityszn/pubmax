import Link from "next/link";

import type { FeaturedOpenTable } from "@/lib/featuredOpenTable.server";
import { displayHandle } from "@/lib/handleDisplay";

import "./openTableCard.css";

const LONDON_DAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/London",
});
const LONDON_TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Europe/London",
});

/**
 * One selected upcoming night. The link opens the crew page, which owns
 * sign-in and the request to join. This card never joins.
 */
export default function OpenTableCard({ table }: { table: FeaturedOpenTable }) {
  const start = new Date(table.startsAt);
  return (
    <section className="socialOpenTable" aria-labelledby="social-open-table">
      <p className="socialOpenTableKicker">Open Table</p>
      <h2 id="social-open-table">{table.meetingPubName}</h2>
      <p>
        <time dateTime={table.startsAt}>{`${LONDON_DAY.format(start)} · ${LONDON_TIME.format(start)}`}</time>
        {" · London"}
      </p>
      <p>Hosted by {displayHandle(table.hostHandle)}</p>
      {table.placesLine === null ? null : <p>{table.placesLine}</p>}
      {table.price ? (
        <p className="socialAlternativeSource">
          {table.price.sentence}{" "}
          <a className="openTableSource" href={table.price.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a>
        </p>
      ) : null}
      <Link className="socialOpenTableAction" prefetch={false} href={`/social/crews/${table.crewId}`}>
        View this night
      </Link>
      <p className="socialAlternativeMeta openTableSmallPrint">Buy your own. Alcohol is optional.</p>
    </section>
  );
}
