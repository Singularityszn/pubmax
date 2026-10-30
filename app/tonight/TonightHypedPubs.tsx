import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";

import PlacePhoto from "@/components/listing/PlacePhoto";
import type { PlacePhoto as PlacePhotoData } from "@/components/listing/placePhotoRules";
import { PintPriceBadge } from "@/components/PriceBadge";
import { RowList } from "@/components/ui/row-list";
import { formatObservedDate, formatObservedDayShort } from "@/lib/dataFreshness";
import {
  hypedPubCredit,
  hypedPubMapHref,
  hypedPubsMapFirst,
  HYPED_PUB_UNMATCHED_LINE,
  HYPED_PUBS_TITLE,
  HYPED_PUBS_VISIBLE,
  type HypedPub,
} from "@/lib/hypedPubs";
import { checkedLabel } from "@/lib/whatsOnBadges";

import TonightHypedReasonFold from "./TonightHypedReasonFold";

/**
 * Pubs Londoners keep recommending, and the first thing Tonight says.
 *
 * Every row carries its own credit because every row IS a claim about what
 * somebody said: the publisher, the day we read them, and the link, so a reader
 * who doubts the line can go and read it themselves. The heading never calls
 * it tonight's talk, because the credit is dated and the date is not tonight.
 *
 * Pubs the map can open come first. A pub we have not got on the map yet
 * still shows, after them, and says so, rather than being dropped for the
 * failing of our own index.
 *
 * ONE LIST, NOT A SHELF OF CARDS (taste plan, 18 Oct 2026). Each pub is a row
 * of the shared RowList shape (components/ui/row-list.tsx): the name is the
 * row's one link onto the map, so the whole row is the tap target and no
 * coral "Open on map" repeats down the page; the area sits under it, the
 * listed pint with its day takes the trailing cell, and "Why this pub" folds
 * the reason and its credit under the name. The fold sits above the row's
 * link layer, so opening it never opens the map. The rows are written out
 * rather than through `RowListItem` because a row carries a test id and a
 * disclosure the primitive has no slot for.
 *
 * A pub we hold a photograph OF (matched by venue id on the server,
 * components/listing/placePhotoRules.ts) shows it inside that fold, under its
 * reason, with its credit. Folded, the lazy image is never fetched, and a pub
 * with no photograph of its own gets none, never a stand-in.
 */
export default function TonightHypedPubs({
  rows = [],
  selectableVenueIds,
  nested = false,
  photos,
}: {
  rows?: readonly HypedPub[];
  /** A recommended pub's own photograph, by venue id, resolved on the server. */
  photos?: Readonly<Record<string, PlacePhotoData>>;
  /** Eager-shard ids the map can open, or null when that index is unreadable. */
  selectableVenueIds?: ReadonlySet<string> | null;
  /**
   * Hosted inside a section that already has a heading (/today's picks), so
   * the list's own title steps down to the line under that heading rather
   * than stacking a second heading on the first.
   */
  nested?: boolean;
}) {
  if (rows.length === 0) return null;
  const ordered = hypedPubsMapFirst(rows, selectableVenueIds);
  const lead = ordered.slice(0, HYPED_PUBS_VISIBLE);
  const rest = ordered.slice(HYPED_PUBS_VISIBLE);

  return (
    <section className="tonightHyped tonightSection" aria-labelledby="tonight-hyped-title">
      {nested ? (
        <h3 className="tonightHypedTitle tonightHypedTitle--nested" id="tonight-hyped-title">
          {HYPED_PUBS_TITLE}
        </h3>
      ) : (
        <h2 className="tonightHypedTitle tonightSectionTitle" id="tonight-hyped-title">
          {HYPED_PUBS_TITLE}
        </h2>
      )}
      <div data-testid="tonight-hyped-list">
        <RowList className="tonightHypedList">
          {lead.map((row) => (
            <HypedRow
              key={rowKey(row)}
              row={row}
              selectableVenueIds={selectableVenueIds}
              photo={row.venueId ? photos?.[row.venueId] : undefined}
            />
          ))}
        </RowList>
        {rest.length > 0 ? (
          <details className="tonightHypedMore">
            <summary className="tonightHypedMoreToggle">
              <ChevronDown size={14} aria-hidden="true" className="tonightHypedMoreChevron" />
              {rest.length === 1 ? "One more pub" : `${rest.length} more pubs`}
            </summary>
            <RowList className="tonightHypedList">
              {rest.map((row) => (
                <HypedRow
                  key={rowKey(row)}
                  row={row}
                  selectableVenueIds={selectableVenueIds}
                  photo={row.venueId ? photos?.[row.venueId] : undefined}
                />
              ))}
            </RowList>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function rowKey(row: HypedPub): string {
  return row.venueId ?? `${row.name}-${row.area}`;
}

function HypedRow({
  row,
  selectableVenueIds,
  photo,
}: {
  row: HypedPub;
  selectableVenueIds?: ReadonlySet<string> | null;
  photo?: PlacePhotoData;
}) {
  const mapHref = hypedPubMapHref(row, selectableVenueIds);
  const credit = hypedPubCredit(row);
  const pint = row.listedPint;
  return (
    <li
      className={
        mapHref
          ? "rowListItem rowListItem--link tonightHypedRow createFabLane"
          : "rowListItem tonightHypedRow createFabLane"
      }
      data-testid="tonight-hyped-row"
    >
      <span className="rowListBody">
        {mapHref ? (
          <Link
            prefetch={false}
            href={mapHref}
            className="rowListTitle rowListTitleLink tonightHypedName"
          >
            {row.name}
          </Link>
        ) : (
          <span className="rowListTitle tonightHypedName">{row.name}</span>
        )}
        <span className="rowListMeta tonightHypedArea">
          {row.area}
          {mapHref ? null : (
            <span className="tonightHypedUnmatched">
              {" · "}
              {HYPED_PUB_UNMATCHED_LINE}
            </span>
          )}
        </span>
        <TonightHypedReasonFold>
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
                <ExternalLink size={14} aria-hidden="true" />
              </a>
              <span className="tonightHypedChecked">{checkedLabel(credit.observedAt)}</span>
            </p>
          ) : null}
          {photo ? (
            <PlacePhoto
              className="tonightHypedPhoto"
              photo={photo}
              sizes="(min-width: 1100px) 24rem, calc(100vw - 2rem)"
            />
          ) : null}
        </TonightHypedReasonFold>
      </span>
      {pint ? (
        // The same figure the cheapest-pints list and the pub's own card
        // read, banded, and never without the day it was listed.
        <span className="rowListTrailing tonightHypedPrice" data-testid="tonight-hyped-price">
          <span className="tonightHypedSr">Cheapest listed pint </span>
          <PintPriceBadge priceGbp={pint.priceGbp} venueId={row.venueId} />
          <span className="tonightHypedListed">
            {"listed "}
            <time
              dateTime={pint.observedAt}
              title={formatObservedDate(new Date(pint.observedAt))}
            >
              {formatObservedDayShort(new Date(pint.observedAt))}
            </time>
          </span>
        </span>
      ) : null}
    </li>
  );
}
