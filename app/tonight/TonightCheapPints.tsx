import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { formatPintDatasetSnapshot } from "@/lib/dataFreshness";
import {
  TONIGHT_CHEAP_PINTS_TITLE,
  tonightCheapPintChainLabel,
  type TonightCheapPint,
} from "@/lib/tonightCheapPints";
import { formatPrice } from "@/lib/venues";

import ledeStyles from "./TonightLede.module.css";

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
    <section className={ledeStyles.tonightCheapPints} aria-labelledby="tonight-cheap-pints-title">
      <h2 className={ledeStyles.tonightCheapPintsTitle} id="tonight-cheap-pints-title">
        {TONIGHT_CHEAP_PINTS_TITLE}
      </h2>
      <ul className={ledeStyles.tonightCheapPintsList} data-testid="tonight-cheap-pints">
        {rows.map((row) => (
          <li key={row.venueId} className={ledeStyles.tonightCheapPintsRow}>
            <Link
              prefetch={false}
              className={`${ledeStyles.tonightCheapPintsLink} pressable`}
              href={`/map?sel=${encodeURIComponent(row.venueId)}`}
            >
              <span className={ledeStyles.tonightCheapPintsBody}>
                <span className={ledeStyles.tonightCheapPintsName}>{row.name}</span>
                <span className={ledeStyles.tonightCheapPintsArea}>
                  {row.borough}
                  {/* The chain is named on its one row, so a Wetherspoon price
                      never reads as a free house's. */}
                  {row.chain ? (
                    <>
                      {" · "}
                      <span data-chain={row.chain}>{tonightCheapPintChainLabel(row.chain)}</span>
                    </>
                  ) : null}
                </span>
              </span>
              <span className={ledeStyles.tonightCheapPintsPrice}>{formatPrice(row.priceGbp)}</span>
              <ArrowRight size={15} aria-hidden="true" className={ledeStyles.tonightCheapPintsArrow} />
            </Link>
          </li>
        ))}
      </ul>
      <p className={ledeStyles.tonightCheapPintsCredit}>{formatPintDatasetSnapshot()}</p>
    </section>
  );
}
