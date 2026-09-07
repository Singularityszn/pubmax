import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { formatPintDatasetSnapshot } from "@/lib/dataFreshness";
import {
  TONIGHT_CHEAP_PINTS_TITLE,
  type TonightCheapPint,
} from "@/lib/tonightCheapPints";
import { formatPrice } from "@/lib/venues";

/**
 * Real pubs on a quiet night, above the mood chips.
 *
 * A night with nothing listed is still a night out, and the answer to it is a
 * pub with a price on it rather than a question about a vibe. The caption
 * carries the collection day, because a listed price is a figure from a day and
 * says so wherever it appears.
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
  return (
    <section className="tonightCheapPints" aria-labelledby="tonight-cheap-pints-title">
      <h2 className="tonightCheapPintsTitle" id="tonight-cheap-pints-title">
        {TONIGHT_CHEAP_PINTS_TITLE}
      </h2>
      <ul className="tonightCheapPintsList" data-testid="tonight-cheap-pints">
        {rows.map((row) => (
          <li key={row.venueId} className="tonightCheapPintsRow">
            <Link
              prefetch={false}
              className="tonightCheapPintsLink pressable"
              href={`/map?sel=${encodeURIComponent(row.venueId)}`}
            >
              <span className="tonightCheapPintsBody">
                <span className="tonightCheapPintsName">{row.name}</span>
                <span className="tonightCheapPintsArea">{row.borough}</span>
              </span>
              <span className="tonightCheapPintsPrice">{formatPrice(row.priceGbp)}</span>
              <ArrowRight size={15} aria-hidden="true" className="tonightCheapPintsArrow" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="tonightCheapPintsCredit">{formatPintDatasetSnapshot()}</p>
    </section>
  );
}
