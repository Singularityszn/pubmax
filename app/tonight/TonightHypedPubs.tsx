import Link from "next/link";
import { ArrowRight, ChevronDown, ExternalLink, MapPin } from "lucide-react";

import {
  hypedPubCredit,
  hypedPubMapHref,
  HYPED_PUB_UNMATCHED_LINE,
  HYPED_PUBS_TITLE,
  HYPED_PUBS_VISIBLE,
  type HypedPub,
} from "@/lib/hypedPubs";
import { checkedLabel } from "@/lib/whatsOnBadges";

/**
 * The pubs people are talking about, and the first thing Tonight says.
 *
 * Every row carries its own credit because every row IS a claim about what
 * somebody said: the publisher, the day we read them, and the link, so a reader
 * who doubts the line can go and read it themselves. A pub we have not got on
 * the map yet still shows, and says so, rather than being dropped for the
 * failing of our own index.
 */
export default function TonightHypedPubs({
  rows = [],
  selectableVenueIds,
}: {
  rows?: readonly HypedPub[];
  /** Eager-shard ids the map can open, or null when that index is unreadable. */
  selectableVenueIds?: ReadonlySet<string> | null;
}) {
  if (rows.length === 0) return null;
  const lead = rows.slice(0, HYPED_PUBS_VISIBLE);
  const rest = rows.slice(HYPED_PUBS_VISIBLE);

  return (
    <section className="tonightHyped" aria-labelledby="tonight-hyped-title">
      <h2 className="tonightHypedTitle" id="tonight-hyped-title">
        {HYPED_PUBS_TITLE}
      </h2>
      <ul className="tonightHypedList" data-testid="tonight-hyped-list">
        {lead.map((row) => (
          <HypedRow key={rowKey(row)} row={row} selectableVenueIds={selectableVenueIds} />
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="tonightHypedMore">
          <summary className="tonightHypedMoreToggle">
            <ChevronDown size={14} aria-hidden="true" className="tonightHypedMoreChevron" />
            {rest.length === 1 ? "One more pub" : `${rest.length} more pubs`}
          </summary>
          <ul className="tonightHypedList">
            {rest.map((row) => (
              <HypedRow key={rowKey(row)} row={row} selectableVenueIds={selectableVenueIds} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function rowKey(row: HypedPub): string {
  return row.venueId ?? `${row.name}-${row.area}`;
}

function HypedRow({
  row,
  selectableVenueIds,
}: {
  row: HypedPub;
  selectableVenueIds?: ReadonlySet<string> | null;
}) {
  const mapHref = hypedPubMapHref(row, selectableVenueIds);
  const credit = hypedPubCredit(row);
  return (
    <li className="tonightHypedRow" data-testid="tonight-hyped-row">
      <h3 className="tonightHypedName">{row.name}</h3>
      <p className="tonightHypedArea">
        <MapPin size={13} aria-hidden="true" />
        <span>{row.area}</span>
      </p>
      <div className="tonightHypedActions">
        <details className="tonightHypedDetails">
          <summary className="tonightHypedMoreToggle">
            <ChevronDown size={14} aria-hidden="true" className="tonightHypedMoreChevron" />
            Why this pub
          </summary>
          <p className="tonightHypedWhy">{row.whyLine}</p>
          {credit ? (
            <p className="tonightHypedCredit">
              <a
                className="tonightHypedSource"
                href={credit.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {credit.label}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
              <span className="tonightHypedChecked">{checkedLabel(credit.observedAt)}</span>
            </p>
          ) : null}
        </details>
        {mapHref ? (
          <Link prefetch={false} className="tonightHypedMap pressable" href={mapHref}>
            Open on map
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        ) : (
          <p className="tonightHypedUnmatched">{HYPED_PUB_UNMATCHED_LINE}</p>
        )}
      </div>
    </li>
  );
}
