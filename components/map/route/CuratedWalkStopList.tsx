"use client";

import { useLayoutEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import CompactVenuePrice from "@/components/map/CompactVenuePrice";
import type { CuratedWalk } from "@/lib/curatedWalk";
import type { CuratedWalkPubs, CuratedWalkStopPubs } from "@/lib/curatedWalkPubs";
import { formatGbp } from "@/lib/formatGbp";
import { formatLogNearbyDistance } from "@/lib/mapLogIntent";

// Room kept above an opened stop for the sheet's own title, and below it for the sheet's edge.
const STOP_REVEAL_TOP_PX = 72;
const STOP_REVEAL_BOTTOM_PX = 16;

function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) return parent;
  }
  return null;
}

function pubCountLabel(group: CuratedWalkStopPubs): string {
  return `${group.rows.length} pub${group.rows.length === 1 ? "" : "s"}`;
}

export default function CuratedWalkStopList({ walk, pubs, selectedStopId, onSelectStop, onSelectPub }: {
  walk: CuratedWalk;
  pubs: CuratedWalkPubs;
  selectedStopId?: string;
  onSelectStop: (id: string) => void;
  onSelectPub: (id: string) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const tapped = useRef<{ id: string; top: number } | null>(null);

  // Another stop's pubs fold away when a stop opens. The tapped row first keeps
  // its place under the finger, then moves only as far as its pubs need.
  useLayoutEffect(() => {
    const pending = tapped.current;
    tapped.current = null;
    if (!selectedStopId) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-stop-id="${CSS.escape(selectedStopId)}"]`);
    const scroller = row ? scrollParent(row) : null;
    if (!row || !scroller) return;
    if (pending?.id === selectedStopId) scroller.scrollTop += row.getBoundingClientRect().top - pending.top;
    const frame = scroller.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    const top = frame.top + STOP_REVEAL_TOP_PX;
    const bottom = Math.min(frame.bottom, window.innerHeight) - STOP_REVEAL_BOTTOM_PX;
    const move = bounds.top < top ? bounds.top - top : Math.min(Math.max(0, bounds.bottom - bottom), bounds.top - top);
    if (Math.abs(move) < 1) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: scroller.scrollTop + move, behavior: smooth ? "smooth" : "auto" });
  }, [selectedStopId]);

  return (
    <ol ref={listRef} className="routeList curatedWalkStops" aria-label="Walking stops in order">
      {walk.stops.map((stop, index) => {
        const selected = selectedStopId === stop.id;
        const group = pubs.byStop.get(stop.id);
        const open = selected && Boolean(group?.rows.length);
        const note = index === 0 ? "Start here" : index === walk.stops.length - 1 ? "Finish here" : stop.note !== stop.name ? stop.note : null;
        return (
          <li key={stop.id} data-stop-id={stop.id} className={selected ? "active" : ""}>
            <button
              type="button"
              aria-current={selected ? "step" : undefined}
              aria-expanded={group?.rows.length ? open : undefined}
              onClick={(event) => {
                tapped.current = { id: stop.id, top: event.currentTarget.parentElement!.getBoundingClientRect().top };
                onSelectStop(stop.id);
              }}
            >
              <span className="stopNumber">{index + 1}</span>
              <span><strong>{stop.name}</strong>{note ? <small>{note}</small> : null}</span>
              <span className="curatedWalkStopPubs" data-pending={pubs.total === 0 || undefined}>
                {group?.rows.length ? (
                  <>
                    <span>{pubCountLabel(group)}<ChevronDown size={16} aria-hidden="true" /></span>
                    {group.cheapestGbp !== null ? <small>from {formatGbp(group.cheapestGbp)}</small> : null}
                  </>
                ) : pubs.total > 0 ? <small>No pubs on the map here</small> : null}
              </span>
            </button>
            {open && group ? (
              <ul className="curatedWalkPubList" aria-label={`Pubs near ${stop.name}`}>
                {group.rows.map((row) => (
                  <li key={row.id}>
                    <button type="button" data-venue-id={row.id} onClick={() => onSelectPub(row.id)}>
                      <span className="curatedWalkPubName">{row.name}</span>
                      {typeof row.distanceKm === "number" ? <span className="curatedWalkPubDistance">{formatLogNearbyDistance(row.distanceKm)}</span> : null}
                      <CompactVenuePrice priceLabel={row.priceLabel} anchor={row.anchor} band={row.priceBand ?? null} className="curatedWalkPubPrice" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
