"use client";

import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { DraftStop } from "@/components/plan/PlanComposer";
import { useStopGestures } from "@/components/plan/useStopGestures";
import { categoryLabel } from "@/lib/drinks";
import { UNRESOLVED_ACCEPTED_STOP_LABEL } from "@/lib/planComposerHandoff";
import { priceBand, priceBandAreaForVenue, priceBandClass } from "@/lib/priceBand";
import {
  formatPenceFixed,
  priceKindLabel,
  walkLabel,
  walkMinutesBetween,
  type MeasuredLegMinutes,
} from "@/lib/planRouteView";
import { selectedDrinkPriceDescription } from "@/lib/planSelectedDrinkPriceEvidence";
import type { PlanVenueOption } from "@/lib/planVenueOptions";
import { venueMapUrl } from "@/lib/venueMapUrl";

/** What a card prints on its price stamp, and whether a pint band may colour it. */
function stampFor(stop: DraftStop): { text: string; bandClass: string } | null {
  const drink = stop.selectedDrinkPriceEvidence;
  if (drink) return { text: formatPenceFixed(drink.pence), bandClass: "" };
  const pence = stop.estimatedPintPricePence;
  if (typeof pence !== "number" || pence <= 0) return null;
  const band = priceBand(pence / 100, priceBandAreaForVenue(stop.venueId));
  return { text: formatPenceFixed(pence), bandClass: priceBandClass(band) };
}

/**
 * The area is the route's, so it is printed only on a stop the generator placed
 * there. Every generated stop carries the generator's `reason` (how far it sits
 * from the area centre); a pub the reader picked or swapped in carries none and
 * may sit anywhere in the city.
 */
function metaFor(stop: DraftStop, areaName: string | null): string {
  const drink = stop.selectedDrinkPriceEvidence;
  const trust = drink ? `${categoryLabel(drink.category)} price` : priceKindLabel(stop.priceKind);
  return [stop.reason ? areaName : null, trust].filter(Boolean).join(" · ");
}

type FinderOption = { value: string; venue: PlanVenueOption };

function placeOf(venue: PlanVenueOption): string | undefined {
  return venue.address ?? venue.borough;
}

function counted(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * One datalist option per pub, and no two alike. A name that more than one pub
 * carries is told apart by where it is, and pubs that share both are numbered,
 * so choosing an option picks that pub and no other.
 */
function finderOptions(venues: readonly PlanVenueOption[]): FinderOption[] {
  const names = counted(venues.map((venue) => venue.name));
  const placed = venues.map((venue) => {
    const place = placeOf(venue);
    return (names.get(venue.name.toLocaleLowerCase()) ?? 0) > 1 && place ? `${venue.name}, ${place}` : venue.name;
  });
  const labels = counted(placed);
  const seen = new Map<string, number>();
  return venues.map((venue, index) => {
    const label = placed[index]!;
    const key = label.toLocaleLowerCase();
    if ((labels.get(key) ?? 0) < 2) return { venue, value: label };
    const ordinal = (seen.get(key) ?? 0) + 1;
    seen.set(key, ordinal);
    return { venue, value: `${label} (${ordinal})` };
  });
}

/**
 * The pub finder an added stop shows until a pub is chosen. Typing only types:
 * a pub is chosen from the list, or by Enter on a name that is one pub's alone,
 * so a name that begins a longer one can be typed past.
 */
function StopFinder({
  label,
  byValue,
  onPick,
}: {
  label: string;
  byValue: ReadonlyMap<string, PlanVenueOption>;
  onPick: (venue: PlanVenueOption) => void;
}) {
  const [text, setText] = useState("");
  const choose = (value: string) => {
    const match = byValue.get(value.trim().toLocaleLowerCase());
    if (match) onPick(match);
  };
  return (
    <input
      className="planStop__find"
      type="text"
      list="plan-venue-options"
      autoComplete="off"
      value={text}
      aria-label={label}
      placeholder="Find a pub"
      onChange={(event) => {
        setText(event.target.value);
        const { inputType } = event.nativeEvent as InputEvent;
        if (!inputType || inputType === "insertReplacementText") choose(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        choose(text);
      }}
    />
  );
}

export type PlanStopListProps = {
  stops: readonly DraftStop[];
  areaName: string | null;
  heldVenueId: string | null;
  measured: MeasuredLegMinutes;
  venues: readonly PlanVenueOption[];
  canAdd: boolean;
  /** Counts up each time a new route arrives, so the cards cross-fade to it. */
  refreshKey: number;
  removable: boolean;
  swapLabel: (stop: DraftStop, index: number) => string;
  swapDisabled: (stop: DraftStop, index: number) => boolean;
  removeLabel: (stop: DraftStop, index: number) => string;
  removeDisabled: (stop: DraftStop, index: number) => boolean;
  onSwap: (key: number) => void;
  onRemove: (key: number) => void;
  onPick: (key: number, venue: PlanVenueOption) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: () => void;
};

/**
 * The route as a route: one card per Stop with the walk between them. A Stop is
 * a venue record, never a string, so there is no name field to type into. A
 * Stop that has no venue yet (one the reader just added) shows a pub finder in
 * its place, and turns into a card the moment a pub is chosen.
 */
export default function PlanStopList({
  stops,
  areaName,
  heldVenueId,
  measured,
  venues,
  canAdd,
  refreshKey,
  removable,
  swapLabel,
  swapDisabled,
  removeLabel,
  removeDisabled,
  onSwap,
  onRemove,
  onPick,
  onReorder,
  onAdd,
}: PlanStopListProps) {
  const [revealedKey, setRevealedKey] = useState<number | null>(null);
  const [revealedOn, setRevealedOn] = useState(refreshKey);
  if (revealedOn !== refreshKey) {
    setRevealedOn(refreshKey);
    setRevealedKey(null);
  }
  const keys = useMemo(() => stops.map((stop) => stop.key), [stops]);
  const firstLocked = Boolean(heldVenueId) && stops[0]?.venueId === heldVenueId;
  const gestures = useStopGestures({ onReorder, revealedKey, keys, onReveal: setRevealedKey, firstLocked, refreshKey });
  const options = useMemo(() => finderOptions(venues), [venues]);
  const byValue = useMemo(
    () => new Map(options.map((option) => [option.value.toLocaleLowerCase(), option.venue])),
    [options],
  );
  // A card the keyboard moved or removed leaves the page or moves in it, which
  // drops focus to the document. Focus goes back to that card, or to the
  // neighbour that takes a removed card's place.
  const listRef = useRef<HTMLOListElement | null>(null);
  const focusAfter = useRef<number | null>(null);
  useLayoutEffect(() => {
    const key = focusAfter.current;
    if (key === null) return;
    focusAfter.current = null;
    listRef.current
      ?.querySelector(`[data-stop-key="${key}"]`)
      ?.querySelector<HTMLElement>(".planStop__open, .planStop__find")
      ?.focus();
  }, [stops]);
  const remove = (index: number) => {
    const key = stops[index]?.key;
    if (key === undefined) return;
    focusAfter.current = (stops[index + 1] ?? stops[index - 1])?.key ?? null;
    if (revealedKey === key) setRevealedKey(null);
    onRemove(key);
  };

  return (
    <div className="planStops">
      <ol
        ref={listRef}
        key={refreshKey}
        className="planStops__list"
        data-fresh={refreshKey > 0 ? "true" : undefined}
        aria-label="Stops, in walking order"
      >
        {stops.map((stop, index) => {
          const resolved = Boolean(stop.venueId.trim());
          const previous = stops[index - 1];
          const minutes = previous && previous.venueId && resolved
            ? walkMinutesBetween(previous, stop, measured)
            : null;
          const stamp = stampFor(stop);
          const drinkLine = selectedDrinkPriceDescription(stop.selectedDrinkPriceEvidence);
          const meta = metaFor(stop, areaName);
          const lifted = gestures.liftedIndex === index;
          return (
            <li
              key={stop.key}
              ref={gestures.itemRef(index)}
              className="planComposer__stop planStop"
              data-stop-key={stop.key}
              data-lifted={lifted ? "true" : undefined}
              data-revealed={revealedKey === stop.key ? "true" : undefined}
            >
              {index > 0 ? (
                <div className="planStop__walk" aria-hidden={minutes === null ? true : undefined}>
                  <span className="planStop__walkLine" aria-hidden="true" />
                  {minutes !== null ? <span className="planStop__walkLabel">{walkLabel(minutes)}</span> : null}
                </div>
              ) : null}
              {resolved ? (
                <div className="planStop__card">
                  <div
                    className="planStop__surface"
                    onPointerDown={gestures.onPointerDown(index)}
                    onPointerMove={gestures.onPointerMove}
                    onClickCapture={gestures.onClickCapture(index)}
                    onKeyDown={(event) => {
                      if (!(event.target as HTMLElement).closest(".planStop__open")) return;
                      gestures.onKeyDown(index, stops.length)(event);
                      if (event.defaultPrevented) {
                        focusAfter.current = stop.key;
                        return;
                      }
                      if ((event.key === "Delete" || event.key === "Backspace") && removable && !removeDisabled(stop, index)) {
                        event.preventDefault();
                        remove(index);
                      }
                    }}
                  >
                    <span className="planStop__badge" aria-hidden="true">{index + 1}</span>
                    <div className="planStop__body">
                      <Link
                        className="planStop__open"
                        href={venueMapUrl(stop.venueId)}
                        prefetch={false}
                        draggable={false}
                        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete Backspace"
                        aria-description="Press and hold to drag to a new place. Alt and the arrow keys move it. Delete removes it."
                      >
                        <span className="planStop__name">{stop.venueName.trim() || UNRESOLVED_ACCEPTED_STOP_LABEL}</span>
                      </Link>
                      {meta ? <span className="planStop__meta">{meta}</span> : null}
                      {drinkLine ? <small className="planComposer__stopReason">{drinkLine}</small> : null}
                    </div>
                    {stamp ? (
                      <strong className={`planStop__price ${stamp.bandClass}`.trim()}>{stamp.text}</strong>
                    ) : null}
                    <button
                      className="planStop__swap planComposer__swap"
                      type="button"
                      data-stop-action
                      onClick={() => {
                        if (!stop.venueName.trim()) focusAfter.current = stop.key;
                        onSwap(stop.key);
                      }}
                      disabled={swapDisabled(stop, index)}
                      aria-label={swapLabel(stop, index)}
                      title={stop.alternatives.length > 0 ? `${stop.alternatives.length} other pubs` : undefined}
                    >
                      <ArrowLeftRight size={18} aria-hidden="true" />
                    </button>
                  </div>
                  {removable ? (
                  <button
                    className="planStop__remove planComposer__remove"
                    type="button"
                    data-stop-action
                    onClick={() => remove(index)}
                    disabled={removeDisabled(stop, index)}
                    aria-label={removeLabel(stop, index)}
                  >
                    Remove
                  </button>
                  ) : null}
                </div>
              ) : (
                <div className="planStop__card planStop__card--empty">
                  <div className="planStop__surface">
                    <span className="planStop__badge" aria-hidden="true">{index + 1}</span>
                    <StopFinder
                      label={`Find a pub for stop ${index + 1}`}
                      byValue={byValue}
                      onPick={(venue) => onPick(stop.key, venue)}
                    />
                    {removable ? (
                    <button
                      className="planStop__drop planComposer__remove"
                      type="button"
                      data-stop-action
                      onClick={() => remove(index)}
                      disabled={removeDisabled(stop, index)}
                      aria-label={removeLabel(stop, index)}
                    >
                      Remove
                    </button>
                    ) : null}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <datalist id="plan-venue-options">
        {options.map(({ value, venue }) => (
          <option key={venue.id} value={value}>{value === venue.name ? placeOf(venue) : null}</option>
        ))}
      </datalist>
      <button className="planComposer__add planStops__add" type="button" disabled={!canAdd} onClick={onAdd}>
        Add another stop
      </button>
    </div>
  );
}
