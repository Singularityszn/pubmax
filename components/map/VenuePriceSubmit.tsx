"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Tag } from "lucide-react";

import {
  drivesMap,
  formatPriceDay,
  COMMUNITY_PRICE_MAX_GBP,
  DEFAULT_SUBMIT_CATEGORY,
  submitCategoryLabel,
  SUBMITTABLE_DRINK_CATEGORIES,
  type CommunityPrice,
} from "@/lib/communityPrice";
import { formatPriceGbp, QUICK_ADD_PRICES_GBP } from "@/lib/spill";
import { mergePriceChips } from "@/lib/spillPreview";
import type { DrinkCategory } from "@/lib/drinks";
import { formatPrice } from "@/lib/venues";
import type { CommunityPricesState } from "@/components/map/useCommunityPrices";

import "./venuePriceSubmit.css";

// The word-of-mouth moment: you're standing in the pub, you tap what you're
// drinking, you type what it cost, and the map restamps under your thumb.
//
// Deliberately NOT the Pint Drop composer. That is the full social object - a
// handle, photos, a note, a visibility lane, a destination. This is the
// twenty-second version for the person at the bar: category, price, done. No
// account, no handle; identity is the same server-derived anonymous actor
// /api/price-confirm already uses.
//
// Provenance is first-class, not decoration: the confirmation shows the price
// with its own dated "today · community" badge, and the scraped/sourced
// baseline keeps rendering underneath it untouched. Nothing here overwrites a
// dataset price - the submission is an additional dated observation.
//
// And the receipt tells the truth about REACH, not just about landing. Since
// the trust wave a lone report is on the pub's page but not on the map, so both
// the receipt and the pre-submit note say so rather than promising a restamp
// this tap has not earned yet (lib/communityPrice.ts owns the policy).

type VenuePriceSubmitProps = {
  venueId: string;
  venueName: string;
  /** Community prices layer - owns the restamp and the POST. */
  communityPrices: CommunityPricesState;
  /** The venue's price on record, used to lead the quick-tap chips. */
  baselinePriceGbp?: number | null;
};

/**
 * The freshest community price for the chosen category, or null. Read from the
 * shared layer so the confirmation and the pin can never disagree.
 */
function priceForCategory(
  rows: CommunityPrice[] | undefined,
  category: DrinkCategory,
): CommunityPrice | null {
  return rows?.find((row) => row.drinkCategory === category) ?? null;
}

export default function VenuePriceSubmit({
  venueId,
  venueName,
  communityPrices,
  baselinePriceGbp = null,
}: VenuePriceSubmitProps) {
  const [category, setCategory] = useState<DrinkCategory>(DEFAULT_SUBMIT_CATEGORY);
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Which drink this viewer just logged, so the receipt celebrates THEIR tap.
  // The dated community price itself is shown in the price block above by
  // VenueOverviewTab for every reader, submitter or not.
  const [logged, setLogged] = useState<DrinkCategory | null>(null);

  const { byVenueId, loadVenue, submit, submitting } = communityPrices;
  // Community prices already on record for this pub, so the card opens showing
  // what the community last said rather than an empty slot.
  useEffect(() => {
    loadVenue(venueId);
  }, [loadVenue, venueId]);

  // The receipt: the freshest community price for the chosen drink. The
  // optimistic submit writes into this same layer, so it appears the instant
  // the button is tapped - the restamp is not a second, local copy of the fact.
  const stamped = priceForCategory(byVenueId.get(venueId), category);

  // The venue's price on record leads the chips - one tap on the likeliest
  // answer beats typing, and a correction is usually a few pence away from it.
  // Three fit one row at 390px; a fourth wraps and the block stops reading as
  // a single row of shortcuts.
  const quickPrices = useMemo(
    () => mergePriceChips(QUICK_ADD_PRICES_GBP, baselinePriceGbp).slice(0, 3),
    [baselinePriceGbp],
  );

  async function logPrice() {
    // The Enter key reaches here even while the button is disabled; one
    // submission at a time keeps the optimistic rollback snapshots coherent.
    if (submitting) return;
    setError(null);
    const result = await submit({ venueId, drinkCategory: category, priceGbp: price });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLogged(category);
    setPrice("");
  }

  return (
    <section className="venuePriceSubmit" aria-labelledby="vpsubTitle">
      <div className="vpsubHead">
        <Tag size={15} aria-hidden="true" />
        <h3 id="vpsubTitle" className="vpsubTitle">
          What&rsquo;s it tonight?
        </h3>
      </div>

      <div
        className="vpsubCats"
        role="radiogroup"
        aria-label={`What are you drinking at ${venueName}?`}
      >
        {SUBMITTABLE_DRINK_CATEGORIES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={category === option}
            className={category === option ? "vpsubCat vpsubCatOn" : "vpsubCat"}
            onClick={() => {
              // The receipt belongs to the drink it was logged for, so
              // switching categories shows that category's own record.
              setCategory(option);
              setError(null);
            }}
          >
            {submitCategoryLabel(option)}
          </button>
        ))}
      </div>

      <div className="vpsubEntry">
        <div className="vpsubField">
          <span className="vpsubCurrency" aria-hidden="true">
            £
          </span>
          <input
            className="vpsubInput"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="4.20"
            value={price}
            maxLength={6}
            aria-label={`Price of a ${submitCategoryLabel(category).toLowerCase()} at ${venueName}, in pounds`}
            aria-invalid={error !== null}
            aria-describedby={error ? "vpsubError" : undefined}
            onChange={(event) => {
              // Keep the field to what a price can be as you type - digits and
              // one separator - so the keypad can't produce an unparseable value.
              setPrice(event.target.value.replace(/[^\d.,]/g, ""));
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void logPrice();
              }
            }}
          />
        </div>
        <button
          type="button"
          className="vpsubLog"
          onClick={() => void logPrice()}
          disabled={submitting || price.trim() === ""}
        >
          {submitting ? "Logging…" : "Log it"}
        </button>
      </div>

      <div className="vpsubQuick" aria-label="Common prices">
        {quickPrices.map((value) => (
          <button
            key={value}
            type="button"
            className="vpsubQuickChip"
            onClick={() => {
              setPrice(formatPriceGbp(value));
              setError(null);
            }}
          >
            {formatPrice(value)}
          </button>
        ))}
      </div>

      {error ? (
        <p id="vpsubError" className="vpsubError" role="alert">
          {error}
        </p>
      ) : null}

      {logged === category && stamped ? (
        // The receipt. Same figure and day label the venue card now carries -
        // one vocabulary, one moment. What it must NOT do is overclaim: a lone
        // report is on the pub's page, not on the map, and saying "on the map"
        // for it would be the exact dishonesty the trust gate exists to fix.
        <p className="vpsubStamp" role="status">
          <Check size={14} aria-hidden="true" className="vpsubStampTick" />
          <strong className="vpsubStampPrice">{formatPrice(stamped.priceGbp)}</strong>
          {/* The provenance word ("community") is already on the dated row in
              the price block above, so the receipt only has to say where the
              tap landed, and when. */}
          <span className="vpsubStampMeta">
            {drivesMap(stamped) ? "On the map" : "On this pub’s page"} ·{" "}
            {formatPriceDay(stamped.submittedAt)}
          </span>
        </p>
      ) : (
        <p className="vpsubNote">
          Anyone can log a price. Yours shows on this pub&rsquo;s page straight
          away, dated and badged as community - it never replaces the price on
          record. It moves the map once a second drinker logs the same. Up to £
          {COMMUNITY_PRICE_MAX_GBP} a drink.
        </p>
      )}
    </section>
  );
}
