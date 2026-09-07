import Link from "next/link";

import { SourceCredit } from "@/components/out/SourceCredit";
import { outListingKindLabel } from "@/lib/out/listingKind";
import { outListingRoute } from "@/lib/out/listingRoute";
import type { WhatsOnRow } from "@/lib/whatsOn";

/**
 * One Out listing, printed whole.
 *
 * Every sourced listing is a real row: what it is, where it is, when it is, and
 * one credit that opens the publisher's own page for it. The card link is the
 * row's own route (lib/out/listingRoute.ts) - the source's event page when it
 * published one, else the pub we matched it to. A row with neither is still a
 * row; it stays visibly static rather than pretending to open something.
 *
 * An anchor inside an anchor is invalid HTML, so the credit is a sibling of the
 * card link, never nested inside it.
 */
export function ticketFromLine(row: WhatsOnRow): string | null {
  if (row.kind !== "event") return null;
  if (typeof row.priceGbp !== "number" || !Number.isFinite(row.priceGbp)) return null;
  const amount = row.priceGbp % 1 === 0 ? row.priceGbp.toFixed(0) : row.priceGbp.toFixed(2);
  return `Tickets from £${amount}`;
}

/**
 * A stated instant and a stated DATE are two different claims, so they print
 * differently. A listing that publishes no clock time gets "Sun 16 Aug" and no
 * time at all: inventing one is a fact the source does not carry.
 */
export function formatWhen(row: WhatsOnRow): string {
  if (row.startsAt) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(row.startsAt));
  }
  if (row.startsDate) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date(`${row.startsDate}T12:00:00.000Z`));
  }
  return row.timeEvidence ?? "";
}

type OutCardTitleLevel = 2 | 4;

type OutCardBodyProps = {
  row: WhatsOnRow;
  onOpen?: () => void;
  titleLevel?: OutCardTitleLevel;
};

export function OutCardBody({ row, onOpen, titleLevel = 2 }: OutCardBodyProps) {
  const from = ticketFromLine(row);
  const when = row.startsAt || row.startsDate ? formatWhen(row) : "";
  const TitleTag = titleLevel === 4 ? "h4" : "h2";
  const route = outListingRoute(row);
  const placeName = row.placeName.trim();
  const content = (
    <>
      <TitleTag>{row.title}</TitleTag>
      <p className="outCardMeta">
        <span className="outCardKind">{outListingKindLabel(row)}</span>
        {placeName ? <span className="outCardPlace">{placeName}</span> : null}
        {when ? <span className="outCardWhen">{when}</span> : null}
      </p>
      {from ? <p className="outPrice">{from}</p> : null}
    </>
  );
  return (
    <>
      {route === null ? (
        <div className="outCard outCard--static">{content}</div>
      ) : route.external ? (
        <a
          className="outCard"
          href={route.href}
          rel="noopener noreferrer"
          target="_blank"
          onClick={onOpen}
        >
          {content}
        </a>
      ) : (
        // The internal route is /map?sel=<venueId>, one of the heavy routes
        // __tests__/linkPrefetchFence.test.ts guards: a list of 63 of them would
        // queue 63 server renders in front of the answer the reader is waiting
        // for. The fence cannot see it through `route.href`, so the guard is
        // stated here rather than left to it.
        <Link className="outCard" prefetch={false} href={route.href} onClick={onOpen}>
          {content}
        </Link>
      )}
      <SourceCredit source={row.source} />
    </>
  );
}

type OutCardProps = OutCardBodyProps;

export function OutCard({ row, onOpen }: OutCardProps) {
  return (
    <li>
      <OutCardBody row={row} onOpen={onOpen} />
    </li>
  );
}
