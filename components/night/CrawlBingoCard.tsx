"use client";

// Pub crawl bingo on the Night Mode card (launch review F2). Nine squares, none
// about drinking, each ticked from an action the app already records for THIS
// night's plan (lib/crawlBingo.ts owns the rule). A square is not a button: a
// free tap on it ticks nothing, so the squares are a plain list.
//
// At nine of nine the card offers one share line through the night-object
// share seam (lib/shareSheet.ts). No image is made for it.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Check, Circle, Share2 } from "lucide-react";

import {
  crawlBingoCountLine,
  crawlBingoShareLine,
  deriveCrawlBingo,
  type CrawlBingoNote,
  type CrawlBingoStop,
} from "@/lib/crawlBingo";
import { readCrawlBingoNotes, subscribeCrawlBingoNotes } from "@/lib/crawlBingoNightLog";
import type { PlanState } from "@/lib/plan";
import { shareNightObject } from "@/lib/shareSheet";
import { siteOrigin } from "@/lib/siteUrl";
import { loadSlimVenues, type SlimVenue } from "@/lib/venuesSlim";
import "./crawlBingo.css";

type Amenities = { garden: boolean; darts: boolean };

const NO_NOTES: readonly CrawlBingoNote[] = [];

function amenitiesOf(row: SlimVenue): Amenities {
  const amenities = row.filterHints?.amenities;
  return { garden: amenities?.beerGarden === true, darts: amenities?.darts === true };
}

export function CrawlBingoCard({
  planId,
  plan,
  stopIndex,
  lastTrainVenueId,
}: {
  planId: string;
  plan: PlanState | null;
  stopIndex: number;
  lastTrainVenueId: string | null;
}) {
  const notes = useSyncExternalStore(subscribeCrawlBingoNotes, readCrawlBingoNotes, () => NO_NOTES);
  const [amenities, setAmenities] = useState<ReadonlyMap<string, Amenities>>(() => new Map());
  const [shareStatus, setShareStatus] = useState("");

  const stopVenueIds = useMemo(
    () => (plan?.stops ?? []).map((stop) => stop.venueId).join("|"),
    [plan?.stops],
  );

  // The amenities come from the slim index the night card already loads; the
  // loader shares one request between them.
  useEffect(() => {
    if (!stopVenueIds) return;
    const wanted = new Set(stopVenueIds.split("|"));
    let active = true;
    loadSlimVenues()
      .then((rows) => {
        if (!active) return;
        const next = new Map<string, Amenities>();
        for (const row of rows) if (wanted.has(row.id)) next.set(row.id, amenitiesOf(row));
        setAmenities(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [stopVenueIds]);

  const card = useMemo(() => {
    const ordered = [...(plan?.stops ?? [])].sort((a, b) => a.position - b.position);
    const stops: CrawlBingoStop[] = ordered.map((stop) => ({
      venueId: stop.venueId,
      position: stop.position,
      garden: amenities.get(stop.venueId)?.garden ?? false,
      darts: amenities.get(stop.venueId)?.darts ?? false,
    }));
    const arrivedPositions = (plan?.actions ?? [])
      .filter((action) => action.type === "arrived" && action.stopPosition !== null)
      .map((action) => action.stopPosition as number);
    return deriveCrawlBingo({
      planId,
      stops,
      arrivedPositions,
      cursor: stopIndex,
      lastTrainVenueId,
      notes,
    });
  }, [amenities, lastTrainVenueId, notes, plan?.actions, plan?.stops, planId, stopIndex]);

  if (!plan || plan.stops.length === 0) return null;

  const title = plan.plan.title;
  const share = async () => {
    setShareStatus("");
    const outcome = await shareNightObject({
      title: crawlBingoShareLine(title),
      text: crawlBingoShareLine(title),
      url: new URL("/", siteOrigin(window.location.href) ?? window.location.origin).toString(),
    });
    if (outcome === "failed") setShareStatus("Could not open a share sheet here.");
  };

  return (
    <section className="crawlBingo" aria-labelledby={`crawl-bingo-${planId}`}>
      <div className="crawlBingo__head">
        <h3 className="crawlBingo__title" id={`crawl-bingo-${planId}`}>
          Pub crawl bingo
        </h3>
        <span className="crawlBingo__count">{crawlBingoCountLine(card.count)}</span>
      </div>
      <ul className="crawlBingo__squares">
        {card.squares.map((square) => (
          <li
            key={square.id}
            className="crawlBingo__square"
            data-square={square.id}
            data-done={square.done ? "" : undefined}
          >
            {square.done ? (
              <Check size={16} role="img" aria-label="Done:" />
            ) : (
              <Circle size={16} role="img" aria-label="Not yet:" />
            )}
            <span>{square.label}</span>
          </li>
        ))}
      </ul>
      {card.fullHouse ? (
        <div className="crawlBingo__fullHouse">
          <p className="crawlBingo__line">{crawlBingoShareLine(title)}</p>
          <button type="button" className="crawlBingo__share" onClick={() => void share()}>
            <Share2 size={16} aria-hidden="true" />
            Share it
          </button>
          {shareStatus ? (
            <p className="crawlBingo__status" role="status">
              {shareStatus}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
