"use client";

import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { useMemo, useState } from "react";

import type { DraftStop } from "@/components/plan/PlanComposer";
import { useStopGestures } from "@/components/plan/useStopGestures";
import { categoryLabel } from "@/lib/drinks";
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

function metaFor(stop: DraftStop, areaName: string | null): string {
  const drink = stop.selectedDrinkPriceEvidence;
  const trust = drink ? `${categoryLabel(drink.category)} price` : priceKindLabel(stop.priceKind);
  return [areaName, trust].filter(Boolean).join(" · ");
}

/** The pub finder an added stop shows until a pub is chosen. */
function StopFinder({
  label,
  byName,
  onPick,
}: {
  label: string;
  byName: ReadonlyMap<string, PlanVenueOption>;
  onPick: (venue: PlanVenueOption) => void;
}) {
  const [text, setText] = useState("");
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
        const match = byName.get(event.target.value.trim().toLocaleLowerCase());
        if (match) onPick(match);
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
  const keys = useMemo(() => stops.map((stop) => stop.key), [stops]);
  const firstLocked = Boolean(heldVenueId) && stops[0]?.venueId === heldVenueId;
  const gestures = useStopGestures({ onReorder, revealedKey, keys, onReveal: setRevealedKey, firstLocked });
  const byName = useMemo(
    () => new Map(venues.map((venue) => [venue.name.toLocaleLowerCase(), venue])),
    [venues],
  );

  return (
    <div className="planStops">
      <ol
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
                    onPointerUp={gestures.onPointerUp}
                    onPointerCancel={gestures.onPointerCancel}
                    onClickCapture={gestures.onClickCapture(index)}
                    onKeyDown={(event) => {
                      if (!(event.target as HTMLElement).closest(".planStop__open")) return;
                      gestures.onKeyDown(index, stops.length)(event);
                      if (event.key === "Delete" && removable && !removeDisabled(stop, index) && !event.defaultPrevented) {
                        event.preventDefault();
                        onRemove(stop.key);
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
                        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete"
                        aria-description="Press and hold to drag to a new place. Alt and the arrow keys move it. Delete removes it."
                      >
                        <span className="planStop__name">{stop.venueName}</span>
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
                      onClick={() => onSwap(stop.key)}
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
                    onClick={() => {
                      setRevealedKey(null);
                      onRemove(stop.key);
                    }}
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
                      byName={byName}
                      onPick={(venue) => onPick(stop.key, venue)}
                    />
                    {removable ? (
                    <button
                      className="planStop__drop planComposer__remove"
                      type="button"
                      data-stop-action
                      onClick={() => onRemove(stop.key)}
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
        {venues.map((venue) => <option key={venue.id} value={venue.name}>{venue.address}</option>)}
      </datalist>
      <button className="planComposer__add planStops__add" type="button" disabled={!canAdd} onClick={onAdd}>
        Add another stop
      </button>
    </div>
  );
}
