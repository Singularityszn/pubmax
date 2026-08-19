import { SourceCredit } from "@/components/out/SourceCredit";
import type { WhatsOnRow } from "@/lib/whatsOn";

/**
 * One Out listing.
 *
 * The card box is the LIST ITEM and it holds TWO sibling links: the listing
 * itself and the source credit (Skiddle's name, logo and event link are a
 * licence obligation). An anchor inside an anchor is invalid HTML - the parser
 * closes the outer one - so the credit may never be nested inside the card link.
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

type OutCardBodyProps = {
  row: WhatsOnRow;
  onOpen?: () => void;
};

export function OutCardBody({ row, onOpen }: OutCardBodyProps) {
  const from = ticketFromLine(row);
  const when = row.startsAt || row.startsDate ? formatWhen(row) : "";
  return (
    <>
      <a
        className="outCard"
        href={row.source.url}
        rel="noopener noreferrer"
        target="_blank"
        onClick={onOpen}
      >
        <h2>{row.title}</h2>
        <p className="outCardMeta">
          {row.placeName}
          {when ? ` · ${when}` : ""}
        </p>
        {from ? <p className="outPrice">{from}</p> : null}
      </a>
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
