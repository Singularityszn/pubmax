import type { Route } from "next";

import { PintPriceBadge } from "@/components/PriceBadge";
import { RowList, RowListItem } from "@/components/ui/row-list";
import TonightPintBelt from "./TonightPintBelt";
import { formatSnapshotFrom } from "@/lib/dataFreshness";
import { oldestPintRead } from "@/lib/drinks";
import {
  TONIGHT_CHEAP_PINTS_TITLE,
  tonightCheapPintChainLabel,
  type TonightCheapPint,
} from "@/lib/tonightCheapPints";

/**
 * Real pubs on a quiet night, above the mood chips.
 *
 * A night with nothing listed is still a night out, and the answer to it is a
 * pub with a price on it rather than a question about a vibe. The section
 * line uses the oldest source read so a newer row cannot redate older prices.
 * If any row has no read date, the section prints no date.
 * Each figure wears its band through the one price badge, never a bare coloured number.
 * From 641px the rows ride a belt of beer mats instead (TonightPintBelt).
 */
export default function TonightCheapPints({
  rows = [],
  show = true,
}: {
  rows?: readonly TonightCheapPint[];
  /** The quiet night this list answers. A busy night keeps its listings. */
  show?: boolean;
}) {
  if (!show || rows.length === 0) return null;
  const observedAt = oldestPintRead(rows.map((row) => row.observedAt));
  return (
    <section
      className="tonightCheapPints tonightSection"
      aria-labelledby="tonight-cheap-pints-title"
    >
      <h2 className="tonightCheapPintsTitle tonightSectionTitle" id="tonight-cheap-pints-title">
        {TONIGHT_CHEAP_PINTS_TITLE}
      </h2>
      {observedAt ? (
        <p className="tonightCheapPintsCredit tonightSectionLine">
          {formatSnapshotFrom(new Date(observedAt))}
        </p>
      ) : null}
      <div className="tonightCheapPintsAnswer" data-testid="tonight-cheap-pints">
        {/* From 641px the same rows ride the belt and this list steps back
            once the belt is ready (tonightPintBelt.css); on a phone, and
            until the belt is placed, the list is the answer. */}
        <TonightPintBelt rows={rows} />
        <RowList className="tonightCheapPintsList tonightCheapPintsBeltList">
          {rows.map((row) => (
            <RowListItem
              key={row.venueId}
              className="tonightCheapPintsRow createFabLane"
              href={`/map?sel=${encodeURIComponent(row.venueId)}` as Route}
              title={row.name}
              meta={
                <>
                  {row.borough}
                  {/* The chain is named on its one row, so a Wetherspoon price
                      never reads as a free house's. */}
                  {row.chain ? (
                    <>
                      {" · "}
                      <span data-chain={row.chain}>{tonightCheapPintChainLabel(row.chain)}</span>
                    </>
                  ) : null}
                </>
              }
              trailing={<PintPriceBadge priceGbp={row.priceGbp} venueId={row.venueId} />}
            />
          ))}
        </RowList>
      </div>
    </section>
  );
}
