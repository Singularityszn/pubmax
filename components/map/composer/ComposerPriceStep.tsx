import { useEffect, useId, useRef } from "react";
import { Minus, Plus } from "lucide-react";

import MeasureChips from "@/components/map/composer/MeasureChips";
import { takeLogIntentReveal } from "@/lib/logIntentReveal";
import { formatPriceChipGbp, stepPrice } from "@/lib/spill";
import type { PintDropsState } from "@/components/map/usePintDrops";

type ComposerPriceStepProps = {
  dropForm: PintDropsState["dropForm"];
  setDropForm: PintDropsState["setDropForm"];
  priceQuickAdds: number[];
  lastKnownPrice: number | null;
};

// ── The price step (price-first door) ───────────────────────────────────────
// The FIRST thing the composer shows: what the pint cost, then WHAT MEASURE,
// then the drink. The venue is already chosen by the sheet, so a price is
// enterable in one tap on a chip. Everything else in the composer is optional
// and lives behind the extras disclosure in PintDropComposer.
//
// The measure row is battle-test D04, and it sits ABOVE the drink field on
// purpose. The drink field used to be the only place a half could be said, its
// own placeholder invited the word, and nothing downstream read it: a "Half of
// lager" at £2.60 went into the pint lane, was confirmed by a second drinker as
// "£2.60 a pint" and fed pin colour, the cheapest buckets and the Pint Index at
// a pub whose pint is £5.50. Asking the closed question before the free one is
// what stops that, and lib/drinkMeasure.ts owns both the set and the words.
export function ComposerPriceStep({
  dropForm,
  setDropForm,
  priceQuickAdds,
  lastKnownPrice,
}: ComposerPriceStepProps) {
  const priceInputId = useId();
  const drinkInputId = useId();
  const stepRef = useRef<HTMLDivElement>(null);

  // `?log=1` asks for this step before the composer exists, and the step
  // answers as it mounts, however long the sheet took to get here.
  useEffect(() => {
    takeLogIntentReveal(stepRef.current);
  }, []);

  return (
    <div ref={stepRef} className="spillPriceStep" data-testid="spill-price-step">
      <div className="priceField">
        <label className="priceFieldLabel" htmlFor={priceInputId}>
          What did it cost?
        </label>
        <div className="priceStepper">
          <button
            type="button"
            className="priceStepBtn"
            aria-label="Decrease price by 10 pence"
            onClick={() => setDropForm({ ...dropForm, price: stepPrice(dropForm.price, -1) })}
          >
            <Minus size={15} />
          </button>
          <input
            id={priceInputId}
            value={dropForm.price}
            onChange={(event) => setDropForm({ ...dropForm, price: event.target.value })}
            placeholder="£"
            inputMode="decimal"
          />
          <button
            type="button"
            className="priceStepBtn"
            aria-label="Increase price by 10 pence"
            onClick={() => setDropForm({ ...dropForm, price: stepPrice(dropForm.price, 1) })}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="priceQuickAdds" role="group" aria-label="Quick-add price">
          {priceQuickAdds.map((price) => {
            const label = formatPriceChipGbp(price);
            const selected = dropForm.price === label;
            const isLastKnown =
              typeof lastKnownPrice === "number" && formatPriceChipGbp(lastKnownPrice) === label;
            return (
              <button
                key={price}
                type="button"
                className={[
                  "priceChip stampChip",
                  selected ? "selected" : "",
                  // A tagged chip carries a word beside its figure, so the
                  // ladder gives it two columns (lib/priceChipLadder.ts).
                  isLastKnown ? "priceChip--tagged" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setDropForm({ ...dropForm, price: label })}
                title={isLastKnown ? "This pub's last logged price" : undefined}
                aria-pressed={selected}
              >
                £{label}
                {isLastKnown ? <span className="priceChipTag">last</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <MeasureChips
        measure={dropForm.measure}
        measureLabel={dropForm.measureLabel}
        onChange={(next) => setDropForm({ ...dropForm, ...next })}
      />

      <label className="spillTextField" htmlFor={drinkInputId}>
        <span className="spillFieldLabel">Drink</span>
        <input
          id={drinkInputId}
          value={dropForm.drink}
          onChange={(event) => setDropForm({ ...dropForm, drink: event.target.value })}
          placeholder="Lager, stout, guest ale"
        />
      </label>
    </div>
  );
}
