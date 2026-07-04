"use client";

import {
  Anchor,
  BadgePoundSterling,
  BookOpen,
  Check,
  Landmark,
  Link2,
  MapPin,
  PlusCircle,
  Route,
  Trophy,
} from "lucide-react";
import { useMemo, useState } from "react";

import { crawlSummary, formatPrice, type Filters, type Venue } from "@/lib/venues";
import { styleLabels, type CrawlMode } from "@/components/map/ControlRail";

// ponytail: cap the keyboard picker render; search narrows the rest.
const PICKER_LIMIT = 40;

type VenueSignals = Map<string, { hasPintDrops: boolean; latestContributorPrice: number | null }>;

type RoutePanelProps = {
  mode: CrawlMode;
  crawlStyle: Filters["crawlStyle"];
  route: Venue[];
  filteredVenues: Venue[];
  builtIds: string[];
  activeVenueId: string | undefined;
  venueSignals: VenueSignals;
  onSelectVenue: (id: string) => void;
  onToggleStop: (id: string) => void;
  children?: React.ReactNode;
};

export default function RoutePanel({
  mode,
  crawlStyle,
  route,
  filteredVenues,
  builtIds,
  activeVenueId,
  venueSignals,
  onSelectVenue,
  onToggleStop,
  children,
}: RoutePanelProps) {
  const summary = useMemo(() => crawlSummary(route), [route]);
  const routeWaterCount = route.filter((venue) => venue.curation.nearWater).length;
  const routeHeritageCount = route.filter((venue) => venue.hasStory).length;
  const routeWriterCount = route.filter((venue) => venue.curation.writerPick).length;

  const [copied, setCopied] = useState(false);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ponytail: clipboard denied (permissions/insecure origin) — no-op, no crash.
    }
  }

  return (
    <aside className="routePanel">
      <div className="routeHeader">
        <div>
          <p className="eyebrow">{mode === "build" ? "Your Crawl" : "Suggested Crawl"}</p>
          <h2>{mode === "build" ? "Hand-built route" : `${styleLabels[crawlStyle]} route`}</h2>
        </div>
        <button
          type="button"
          className="shareBtn"
          onClick={copyLink}
          aria-label="Copy a shareable link to this crawl"
        >
          {copied ? <Check size={14} /> : <Link2 size={14} />}
          {copied ? "Copied!" : "Copy link"}
        </button>
        <Route size={24} />
      </div>

      <div className="routeMetrics">
        <div>
          <BadgePoundSterling size={17} />
          <span>{formatPrice(summary.total)}</span>
          <small>estimated round</small>
        </div>
        <div>
          <MapPin size={17} />
          <span>{summary.distance.toFixed(1)} km</span>
          <small>between stops</small>
        </div>
        <div>
          <Trophy size={17} />
          <span>{route.length}</span>
          <small>stops</small>
        </div>
        <div>
          <Landmark size={17} />
          <span>{routeHeritageCount}</span>
          <small>story pubs</small>
        </div>
        <div>
          <Anchor size={17} />
          <span>{routeWaterCount}</span>
          <small>by water</small>
        </div>
        <div>
          <BookOpen size={17} />
          <span>{routeWriterCount}</span>
          <small>writer picks</small>
        </div>
      </div>

      {route.length === 0 ? (
        <p className="emptyRoute">
          {mode === "build"
            ? "No stops yet. Tap pubs on the map or use the Add stops list below."
            : "No suggested route matches these filters. Reset filters or widen the route window."}
        </p>
      ) : null}

      <ol className="routeList">
        {route.map((venue, index) => (
          <li key={venue.id} className={activeVenueId === venue.id ? "active" : ""}>
            <button
              type="button"
              onClick={() => onSelectVenue(venue.id)}
              aria-current={activeVenueId === venue.id ? "true" : undefined}
            >
              <span className="stopNumber">{index + 1}</span>
              <div>
                <strong>{venue.name}</strong>
                <p>
                  {formatPrice(
                    venueSignals.get(venue.id)?.latestContributorPrice ?? venue.cheapestPrice,
                  )}{" "}
                  · {venue.cheapestPint}
                </p>
                <small>
                  {venue.curation.storyTag ||
                    venue.primaryBorough ||
                    venue.visibleBoroughs[0] ||
                    "London"}
                </small>
              </div>
            </button>
          </li>
        ))}
      </ol>

      {mode === "build" ? (
        <section className="venuePicker">
          <div className="inspectorTitle">
            <PlusCircle size={16} />
            <span>Add stops</span>
          </div>
          <p className="description muted">
            Every filtered pub, keyboard-friendly — the map is optional. Use search and filters to
            narrow the list.
          </p>
          <ul className="venuePickerList">
            {filteredVenues.slice(0, PICKER_LIMIT).map((venue) => {
              const inCrawl = builtIds.includes(venue.id);
              return (
                <li key={venue.id}>
                  <button
                    type="button"
                    aria-pressed={inCrawl}
                    onClick={() => {
                      onSelectVenue(venue.id);
                      onToggleStop(venue.id);
                    }}
                  >
                    <span>
                      <strong>{venue.name}</strong>
                      <small>
                        {formatPrice(venue.cheapestPrice)} ·{" "}
                        {venue.primaryBorough || venue.visibleBoroughs[0] || "London"}
                      </small>
                    </span>
                    <span className="pickAction">{inCrawl ? "Remove" : "Add"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {filteredVenues.length > PICKER_LIMIT ? (
            <small className="pickerNote">
              Showing {PICKER_LIMIT} of {filteredVenues.length} — narrow the search to see more.
            </small>
          ) : null}
        </section>
      ) : null}

      {children}
    </aside>
  );
}
