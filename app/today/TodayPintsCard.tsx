"use client";

// "Cheapest pints near you today" — the map's Area-button derivation surfaced on
// the morning brief. The server precomputes a tight five for every area, so this
// only reads the viewer's remembered area and swaps to the matching precomputed
// list (no venue data ships to the browser, the swap is instant, and the first
// paint always matches SSR: the central default).
//
// We always SAY which area these pints are from and link to change it on the map,
// and every row deep-links to its venue on the map. Fail-soft: an area with no
// verified prices renders nothing, never an empty box.

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Beer } from "lucide-react";

import { readRememberedArea } from "@/lib/nightPatches";

import {
  resolveTodayPintsPatchId,
  type TodayPintsIndex,
  type TodayPintsModule,
} from "./todayPints";

type Props = { index: TodayPintsIndex };

type TodayPintsView = {
  pints: TodayPintsModule | null;
  hasRememberedLocality: boolean;
};

function viewFor(
  index: TodayPintsIndex,
  remembered: Parameters<typeof resolveTodayPintsPatchId>[0],
): TodayPintsView {
  const id = resolveTodayPintsPatchId(remembered, index);
  return {
    pints: id ? index[id] : null,
    hasRememberedLocality:
      remembered?.kind === "patch" && id === remembered.id,
  };
}

export default function TodayPintsCard({ index }: Props) {
  const [view, setView] = useState<TodayPintsView>(() => viewFor(index, null));

  useEffect(() => {
    // Deferred read (matches PicksCard): localStorage is the external sync, so the
    // first paint stays on the central default from SSR, then settles to the
    // remembered area on the next microtask.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setView(viewFor(index, readRememberedArea()));
    });
    return () => {
      cancelled = true;
    };
  }, [index]);

  if (!view.pints) return null;
  const { pints, hasRememberedLocality } = view;

  return (
    <section className="todayCard" aria-labelledby="today-pints-title" data-testid="today-pints">
      <div className="todayCardHead">
        <span className="todayCardIcon" aria-hidden="true">
          <Beer size={18} />
        </span>
        <div>
          <p className="todayCardEyebrow">
            {hasRememberedLocality
              ? "Cheapest pints near you today"
              : "Cheapest pints in central London today"}
          </p>
          <h2 className="todayCardTitle" id="today-pints-title">
            The cheap ones in {pints.areaName}.
          </h2>
        </div>
      </div>

      <ul className="todayPintList">
        {pints.rows.map((row) => (
          <li key={row.id} className="todayPintRow">
            <Link className="todayPintLink pressable" href={row.mapHref}>
              <span className="todayPintName">{row.name}</span>
              <span className="todayPintPrice">{row.priceLabel}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="todayCardFootRow">
        <span className="todayProvenance">The cheapest we&rsquo;ve got in {pints.areaName}.</span>
        <Link href="/map" className="todayTextButton">
          Change area
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </p>
    </section>
  );
}
