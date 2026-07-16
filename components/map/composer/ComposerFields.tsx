import { useId } from "react";
import { Mic, MicOff, Minus, Plus } from "lucide-react";

import { VIBE_TAGS } from "@/lib/pintDropShared";
import {
  VISIBILITIES,
  formatPriceGbp,
  stepPrice,
  type Visibility,
} from "@/lib/spill";
import {
  SPILL_DESTINATIONS,
  DESTINATION_META,
  resolveDestination,
  type SpillDestination,
} from "@/lib/spillPreview";
import { GENERATION_PRESETS, VISIBILITY_COPY } from "@/lib/pintDropComposerConfig";
import type { PintDropsState } from "@/components/map/usePintDrops";

type ComposerFieldsProps = {
  handle: PintDropsState["handle"];
  setHandle: PintDropsState["setHandle"];
  dropForm: PintDropsState["dropForm"];
  setDropForm: PintDropsState["setDropForm"];
  vibeTags: PintDropsState["vibeTags"];
  toggleVibeTag: PintDropsState["toggleVibeTag"];
  maxTagsReached: boolean;
  visibility: Visibility;
  setVisibility: PintDropsState["setVisibility"];
  hasActiveRound: boolean;
  destination: SpillDestination | null;
  chooseDestination: (key: SpillDestination) => void;
  setDestination: (value: SpillDestination | null) => void;
  priceQuickAdds: number[];
  lastKnownPrice: number | null;
  speechSupported: boolean;
  listening: boolean;
  toggleListening: () => void;
};

export function ComposerFields({
  handle,
  setHandle,
  dropForm,
  setDropForm,
  vibeTags,
  toggleVibeTag,
  maxTagsReached,
  visibility,
  setVisibility,
  hasActiveRound,
  destination,
  chooseDestination,
  setDestination,
  priceQuickAdds,
  lastKnownPrice,
  speechSupported,
  listening,
  toggleListening,
}: ComposerFieldsProps) {
  const handleId = useId();
  const priceInputId = useId();
  const drinkInputId = useId();
  const noteInputId = useId();
  const withWhoInputId = useId();
  const eraInputId = useId();

  return (
    <>
      <label className="spillTextField" htmlFor={handleId}>
        <span className="spillFieldLabel">Handle</span>
        <input
          id={handleId}
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder="@thirsty_ted"
          required
        />
      </label>

      {/* ── One-tap destinations (PRD priority 2) ──────────────────────────
          Shortcuts onto EXISTING visibility semantics. My Round is disabled
          (never faked) unless a Round is actually open. */}
      <fieldset className="destinationField">
        <legend>Add to</legend>
        <div className="destinationRow" role="group" aria-label="Add this Spill to">
          {SPILL_DESTINATIONS.map((key) => {
            const meta = DESTINATION_META[key];
            const resolved = resolveDestination(key, hasActiveRound);
            const selected = destination === key;
            return (
              <button
                key={key}
                type="button"
                className={selected ? "destinationChip selected" : "destinationChip"}
                aria-pressed={selected}
                disabled={!resolved.enabled}
                title={resolved.helper}
                onClick={() => chooseDestination(key)}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
        {destination ? (
          <p className="destinationHelper">
            {resolveDestination(destination, hasActiveRound).helper}
          </p>
        ) : null}
      </fieldset>

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
            const label = formatPriceGbp(price);
            const selected = dropForm.price === label;
            const isLastKnown =
              typeof lastKnownPrice === "number" && formatPriceGbp(lastKnownPrice) === label;
            return (
              <button
                key={price}
                type="button"
                className={selected ? "priceChip stampChip selected" : "priceChip stampChip"}
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

      <label className="spillTextField" htmlFor={drinkInputId}>
        <span className="spillFieldLabel">Drink</span>
        <input
          id={drinkInputId}
          value={dropForm.drink}
          onChange={(event) => setDropForm({ ...dropForm, drink: event.target.value })}
          placeholder="Pint, half, soda, guest ale"
        />
      </label>

      <div className="noteField">
        <div className="spillFieldHeader">
          <label className="spillFieldLabel" htmlFor={noteInputId}>
            Story
          </label>
          <span className="voiceAffordance">Type or talk it in</span>
        </div>
        <div className="noteFieldRow">
          <textarea
            id={noteInputId}
            value={dropForm.note}
            onChange={(event) => {
              setDropForm({ ...dropForm, note: event.target.value });
            }}
            placeholder="What happened?"
          />
          {speechSupported ? (
            <button
              type="button"
              className={listening ? "micBtn listening" : "micBtn"}
              aria-pressed={listening}
              aria-label={listening ? "Stop voice note" : "Add note by voice"}
              onClick={toggleListening}
            >
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          ) : null}
        </div>
        {speechSupported ? (
          <span role="status" className="visuallyHidden">
            {listening ? "Listening…" : ""}
          </span>
        ) : null}
      </div>

      <label className="spillTextField" htmlFor={withWhoInputId}>
        <span className="spillFieldLabel">With</span>
        <input
          id={withWhoInputId}
          value={dropForm.withWho}
          onChange={(event) => setDropForm({ ...dropForm, withWho: event.target.value })}
          placeholder="@sam, @priya, or names"
        />
      </label>

      <fieldset className="generationField">
        <legend>When is this from?</legend>
        <div className="generationRow" role="group" aria-label="Generation mode">
          {GENERATION_PRESETS.map((preset) => {
            const selected = dropForm.era === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                className={selected ? "generationChip selected" : "generationChip"}
                aria-pressed={selected}
                onClick={() => setDropForm({ ...dropForm, era: preset.value })}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <label className="visuallyHidden" htmlFor={eraInputId}>
          Custom generation or memory label
        </label>
        <input
          id={eraInputId}
          value={dropForm.era}
          onChange={(event) => setDropForm({ ...dropForm, era: event.target.value })}
          placeholder="Or write your own: 1998, first date, dad's local"
        />
      </fieldset>

      <fieldset className="vibeTagField">
        <legend>The vibe</legend>
        <div className="vibeTagRow" role="group" aria-label="Vibe tags — choose up to 4">
          {VIBE_TAGS.map((tag) => {
            const selected = vibeTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                className={selected ? "vibeChip selected" : "vibeChip"}
                aria-pressed={selected}
                disabled={!selected && maxTagsReached}
                onClick={() => toggleVibeTag(tag)}
              >
                {tag}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Visibility is now SECONDARY (PRD priority 2): the one-tap
          destinations above are the primary lane pick; this segmented control
          stays for fine-grained control and keeps the accessible radiogroup. */}
      <fieldset className="visibilityField">
        <legend>Who sees this</legend>
        <div className="visibilitySegment" role="radiogroup" aria-label="Visibility">
          {VISIBILITIES.map((option) => {
            const selected = visibility === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                className={selected ? "visibilityOption selected" : "visibilityOption"}
                onClick={() => {
                  setVisibility(option);
                  setDestination(null); // A manual lane pick clears the chip.
                }}
              >
                {VISIBILITY_COPY[option].label}
              </button>
            );
          })}
        </div>
        <p className="visibilityHelper">{VISIBILITY_COPY[visibility].helper}</p>
      </fieldset>
    </>
  );
}
