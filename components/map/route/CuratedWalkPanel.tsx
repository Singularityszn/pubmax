"use client";

import { useEffect, useMemo, useState } from "react";
import { Beer, Copy, Eye, EyeOff, Footprints } from "lucide-react";
import { Button } from "@/components/ui/button";
import { curatedCrawlMapHref, type CuratedCrawl } from "@/lib/curatedCrawls";
import { curatedWalkKm, curatedWalkMinutes, type CuratedWalk } from "@/lib/curatedWalk";
import { curatedWalkPubs, WALK_PUB_REACH_METRES } from "@/lib/curatedWalkPubs";
import type { PintCapSignals } from "@/lib/comparableVenuePint";
import { formatGbp } from "@/lib/formatGbp";
import type { Venue } from "@/lib/venues";
import type { ZonePintIndex } from "@/lib/zones";
import CuratedWalkStopList from "./CuratedWalkStopList";
import "./curatedWalk.css";

export default function CuratedWalkPanel({ crawl, walk, venues, venueSignals, zoneIndex, mapped, onMap, onHide, onSelectStop, selectedStopId, titleInSheet, onClear }: {
  crawl: CuratedCrawl;
  walk: CuratedWalk;
  /** The pubs the map is showing. The walk lists the ones beside its line. */
  venues: readonly Venue[];
  venueSignals?: PintCapSignals | null;
  zoneIndex?: ZonePintIndex | null;
  mapped: boolean;
  onMap: () => void;
  onHide: () => void;
  onSelectStop: (id: string) => void;
  selectedStopId?: string;
  titleInSheet?: boolean;
  onClear?: () => void;
}) {
  const [copyMessage, setCopyMessage] = useState("");
  const pubs = useMemo(() => curatedWalkPubs(walk, venues, venueSignals, zoneIndex), [walk, venues, venueSignals, zoneIndex]);
  useEffect(() => {
    if (copyMessage !== "Link copied") return;
    const timer = window.setTimeout(() => setCopyMessage(""), 2000);
    return () => window.clearTimeout(timer);
  }, [copyMessage]);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(new URL(curatedCrawlMapHref(crawl), window.location.origin).href);
      setCopyMessage("Link copied");
    } catch {
      setCopyMessage("Could not copy the link. Try again.");
    }
  }
  return (
    <aside className="routePanel curatedWalkPanel" aria-label={crawl.name}>
      <div className="curatedWalkHeading">
        {titleInSheet ? <p className="curatedWalkTiming">{walk.bestTime}</p> : <h2>{crawl.name}</h2>}
      </div>
      {!titleInSheet ? <p className="curatedWalkTiming">{walk.bestTime}</p> : null}
      <div className="curatedWalkSummary">
        <p className="curatedWalkMetrics"><Footprints size={16} aria-hidden="true" /><span>{walk.stops.length} stops · approx. {curatedWalkKm(walk).toFixed(1)} km<small>About {curatedWalkMinutes(walk)} min walking</small></span></p>
        <p className="curatedWalkMetrics" data-pending={pubs.total === 0 || undefined}><Beer size={16} aria-hidden="true" /><span>{pubs.total} pubs on the way<small>{pubs.cheapestGbp !== null ? `Pints from ${formatGbp(pubs.cheapestGbp)}` : "Tap a stop for its pubs"}</small></span></p>
      </div>
      <div className="curatedWalkActions">
        <Button variant="ghost" aria-label="Copy walk link" onClick={() => void copyLink()}><Copy size={16} />Copy link</Button>
        <Button variant="ghost" aria-label={mapped ? "Hide walking route" : "Show walking route"} title={mapped ? "Hide walking route" : "Show walking route"} onClick={mapped ? onHide : onMap}>
          {mapped ? <EyeOff size={16} /> : <Eye size={16} />}{mapped ? "Hide route" : "Show route"}
        </Button>
      </div>
      <p role="status" className="curatedWalkCopyStatus">{copyMessage}</p>
      <CuratedWalkStopList walk={walk} pubs={pubs} selectedStopId={selectedStopId} onSelectStop={onSelectStop} onSelectPub={onSelectStop} />
      {onClear ? <Button variant="ghost" onClick={onClear}>Plan something else</Button> : null}
      <details className="curatedWalkSources">
        <summary>Route sources and access</summary>
        <p>{walk.credit} Recorded {walk.observedOn}. Crossings and access can change.</p>
        {walk.accessNotes.map((note) => <p key={note}>{note}</p>)}
        <p>Pubs are within about {WALK_PUB_REACH_METRES} metres of the route. Open a pub to see where its price comes from and when it was read.</p>
        <ul>{walk.stops.map((stop) => <li key={stop.id}><a href={stop.source} target="_blank" rel="noreferrer">{stop.name} on OpenStreetMap</a></li>)}</ul>
      </details>
    </aside>
  );
}
