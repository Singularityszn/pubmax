import type { Route } from "next";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";

import { dealDigestNote } from "@/lib/dealsDigest";
import {
  groupTonightListings,
  type TonightGroupedRow,
} from "@/lib/tonightListGrouping";
import {
  tonightChainLaneAnswers,
  TONIGHT_CHAIN_LANE_VISIBLE,
  type TonightChainLaneAnswer,
} from "@/lib/tonightChainLanes";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { checkedLabel, laneTimeLabel } from "@/lib/whatsOnBadges";

/**
 * The chain blocks, under the lede.
 *
 * A chain's supply is real and a reader may want it, so it is shown. It is
 * shown under the chain's own name, with the day that chain's page was read
 * beside it, because "Deals tonight" over a Wetherspoon row told a reader the
 * city was offering something when one company was.
 *
 * ONE CARD PER OFFER, not per pub. The same grouping the main list takes
 * (`groupTonightListings`) collapses one syndicated offer across 96 pubs into
 * one row that says how many pubs run it, which is the whole reason that rule
 * exists. Three rows show and the rest fold away.
 */
export default function TonightChainDeals({
  rows,
  selectableVenueIds,
}: {
  rows: readonly WhatsOnRow[];
  selectableVenueIds?: ReadonlySet<string> | null;
}) {
  const lanes = tonightChainLaneAnswers(rows);
  if (lanes.length === 0) return null;
  return (
    <div className="tonightChains" data-testid="tonight-chain-lanes">
      {lanes.map((lane) => (
        <ChainLane key={lane.key} lane={lane} selectableVenueIds={selectableVenueIds} />
      ))}
    </div>
  );
}

function ChainLane({
  lane,
  selectableVenueIds,
}: {
  lane: TonightChainLaneAnswer;
  selectableVenueIds?: ReadonlySet<string> | null;
}) {
  const titleId = `tonight-chain-${lane.key}`;
  const groups = groupTonightListings(lane.rows, null);
  const lead = groups.slice(0, TONIGHT_CHAIN_LANE_VISIBLE);
  const rest = groups.slice(TONIGHT_CHAIN_LANE_VISIBLE);
  return (
    <section className="tonightChain" aria-labelledby={titleId} data-lane={lane.key}>
      <h2 className="tonightChainTitle" id={titleId}>
        {lane.title}
      </h2>
      <p className="tonightChainCredit">
        <span>{lane.sourceLabel}</span>
        <span className="tonightChainChecked">{checkedLabel(lane.observedAt)}</span>
      </p>
      <ul className="tonightChainList">
        {lead.map((group) => (
          <ChainRow
            key={group.row.id}
            group={group}
            selectableVenueIds={selectableVenueIds}
          />
        ))}
      </ul>
      {rest.length > 0 ? (
        <details className="tonightChainMore">
          <summary className="tonightChainMoreToggle">
            <ChevronDown size={14} aria-hidden="true" className="tonightChainMoreChevron" />
            {rest.length === 1 ? "One more offer" : `${rest.length} more offers`}
          </summary>
          <ul className="tonightChainList">
            {rest.map((group) => (
              <ChainRow
                key={group.row.id}
                group={group}
                selectableVenueIds={selectableVenueIds}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function ChainRow({
  group,
  selectableVenueIds,
}: {
  group: TonightGroupedRow;
  selectableVenueIds?: ReadonlySet<string> | null;
}) {
  const row: WhatsOnRow = group.row;
  const when = laneTimeLabel(row);
  const alsoAt = dealDigestNote(group.venueCount);
  const mapHref: Route | null =
    row.venueId && (selectableVenueIds === undefined || selectableVenueIds?.has(row.venueId))
      ? `/map?sel=${encodeURIComponent(row.venueId)}`
      : null;
  return (
    <li className="tonightChainRow" data-testid="tonight-chain-row">
      <p className="tonightChainRowTitle">{row.title}</p>
      <p className="tonightChainRowPlace">
        <span>{row.placeName}</span>
        {when ? <span className="tonightChainRowWhen">{when}</span> : null}
      </p>
      {alsoAt ? <p className="tonightChainRowAlso">{alsoAt}</p> : null}
      {mapHref ? (
        <Link prefetch={false} className="tonightChainRowMap pressable" href={mapHref}>
          Open on map
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      ) : null}
    </li>
  );
}
