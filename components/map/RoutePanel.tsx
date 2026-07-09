"use client";

import {
  Anchor,
  BadgePoundSterling,
  Beer,
  BookOpen,
  Check,
  Footprints,
  Landmark,
  Link2,
  MapPin,
  PlusCircle,
  Route,
  Trophy,
  ArrowUpDown,
  CalendarPlus,
  TrainFront,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { crawlSummary, formatPrice, type Filters, type Venue } from "@/lib/venues";
import { loadPois, type Poi } from "@/lib/pois";
import {
  buildRouteLegs,
  formatLeg,
  formatRouteTotal,
  poisOnRoute,
  type RoutePace,
} from "@/lib/routeLegs";
import { styleLabels, type CrawlMode } from "@/components/map/ControlRail";
import SaveCrawlStory from "@/components/crawl/SaveCrawlStory";
import {
  ALT_CRAWL_STYLES,
  altStyleLabels,
  altStyleStopNoun,
  type AltCrawlStyle,
} from "@/lib/crawlUrl";
import { buildCrawlIcs, icsFilename } from "@/lib/icsExport";
import {
  acknowledgeCrawlCompletion,
  isComplete,
  markCrawlComplete,
  readCrawl,
  startCrawl,
  type CrawlProgressEntry,
} from "@/lib/crawlCompletion";
import { curatedCrawlById, crawlShareMapHref } from "@/lib/curatedCrawls";
import "@/components/map/routePanel.css";

// ponytail: cap the keyboard picker render; search narrows the rest.
const PICKER_LIMIT = 40;

type VenueSignals = Map<
  string,
  { hasPintDrops: boolean; dropCount?: number; latestContributorPrice: number | null }
>;

type RoutePanelProps = {
  mode: CrawlMode;
  crawlStyle: Filters["crawlStyle"];
  // Alt crawl style (issue #31): the "kind of night" label. Shapes copy + the
  // .ics export noun; independent of the scoring crawlStyle above.
  altStyle: AltCrawlStyle;
  onAltStyleChange: (style: AltCrawlStyle) => void;
  route: Venue[];
  filteredVenues: Venue[];
  builtIds: string[];
  activeVenueId: string | undefined;
  venueSignals: VenueSignals;
  crawlBlurb?: string;
  crawlName?: string;
  crawlId?: string;
  routeMapped: boolean;
  originDistanceKm?: number | null;
  onMapRoute: () => void;
  onHideRoute: () => void;
  onCheckLastTrain?: () => void;
  onSelectVenue: (id: string) => void;
  onToggleStop: (id: string) => void;
  onReverseRoute?: () => void;
  children?: React.ReactNode;
};

// Trigger a client-side .ics download via a blob URL. Kept tiny + SSR-guarded.
function downloadIcs(filename: string, contents: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([contents], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function RoutePanel({
  mode,
  crawlStyle,
  altStyle,
  onAltStyleChange,
  route,
  filteredVenues,
  builtIds,
  activeVenueId,
  venueSignals,
  crawlBlurb,
  crawlName,
  crawlId,
  routeMapped,
  originDistanceKm,
  onMapRoute,
  onHideRoute,
  onCheckLastTrain,
  onSelectVenue,
  onToggleStop,
  onReverseRoute,
  children,
}: RoutePanelProps) {
  const summary = useMemo(() => crawlSummary(route), [route]);
  const routeWaterCount = route.filter((venue) => venue.curation.nearWater).length;
  const routeHeritageCount = route.filter((venue) => venue.hasStory).length;
  const routeWriterCount = route.filter((venue) => venue.curation.writerPick).length;

  // Walking (or running) legs between stops (story 25) — pure math from
  // lib/routeLegs, honestly labelled "straight-line" throughout.
  const [pace, setPace] = useState<RoutePace>("walk");
  const legSummary = useMemo(() => buildRouteLegs(route, pace), [route, pace]);

  // "On the way" POI threading (story 26): garden/market/historic/viewpoint
  // POIs within ~250m of a leg. Loaded independently of the map canvas — a
  // second, cheap client fetch of the same bundled dataset — so RoutePanel
  // doesn't need PubMapCanvas's internal POI state lifted out.
  const [pois, setPois] = useState<Poi[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadPois()
      .then((loaded) => {
        if (!cancelled) setPois(loaded);
      })
      .catch(() => {
        // "On the way" is a nicety — a fetch failure just leaves it empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const onTheWayByLeg = useMemo(
    () => poisOnRoute(legSummary.legs, pois),
    [legSummary.legs, pois],
  );

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

  // Alt-style copy: a "coffee stop" / "food stop" / "mocktail stop" instead of
  // the default "pint stop". A single source (lib/crawlUrl) keeps label + noun
  // in sync with the URL round-trip.
  const stopNoun = altStyleStopNoun[altStyle];
  const crawlTitle =
    mode === "build" ? crawlName || "My hand-built crawl" : `${styleLabels[crawlStyle]} crawl`;

  // Loop 2 crawl-completion stickiness — localStorage only. Key off crawlId when
  // present, else a stable title slug so hand-built routes still track.
  const progressKey = (crawlId || crawlTitle).trim();
  const placeStoryBandId = crawlId
    ? curatedCrawlById(crawlId)?.placeStoryBandId
    : undefined;
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgressEntry | null>(null);
  // Wave G2: one-shot celebration after 100% — claimed via acknowledgeCrawlCompletion.
  const [showCelebration, setShowCelebration] = useState(false);

  function applyCompletionAck(entry: CrawlProgressEntry | null) {
    setCrawlProgress(entry);
    if (!progressKey || !isComplete(entry)) {
      setShowCelebration(false);
      return;
    }
    const ack = acknowledgeCrawlCompletion(progressKey, { placeStoryBandId });
    setShowCelebration(ack.celebrate);
  }

  useEffect(() => {
    let active = true;
    async function hydrate() {
      const entry = progressKey && route.length >= 2 ? readCrawl(progressKey) : null;
      if (!active) return;
      setCrawlProgress(entry);
      // Remount with an already-complete crawl: credit quest if needed, but only
      // celebrate when the one-shot flag is still unset.
      if (progressKey && isComplete(entry)) {
        const ack = acknowledgeCrawlCompletion(progressKey, { placeStoryBandId });
        if (active) setShowCelebration(ack.celebrate);
      } else if (active) {
        setShowCelebration(false);
      }
    }
    void hydrate();
    return () => {
      active = false;
    };
  }, [progressKey, route.length, placeStoryBandId]);

  function handleStartCrawl() {
    if (!progressKey || route.length < 2) return;
    const entry = startCrawl(
      progressKey,
      route.map((v) => v.id),
    );
    setCrawlProgress(entry);
    setShowCelebration(false);
  }

  function handleMarkComplete() {
    if (!progressKey) return;
    // Ensure there's an entry to complete (start if the walker skipped "Start").
    if (!readCrawl(progressKey)) {
      startCrawl(
        progressKey,
        route.map((v) => v.id),
      );
    }
    const entry = markCrawlComplete(progressKey);
    applyCompletionAck(entry);
  }

  const crawlDone = isComplete(crawlProgress);
  const dropHref =
    route.length > 0
      ? `/map?log=1&sel=${encodeURIComponent(route[route.length - 1]!.id)}`
      : "/map?log=1";
  // Wave H1: share the walked route as a map deep-link (pubs + optional band).
  const shareMapHref = crawlShareMapHref({
    venueIds: route.map((v) => v.id),
    placeStoryBandId,
    crawlId,
  });
  const [shareCopied, setShareCopied] = useState(false);

  async function copyShareLink() {
    const absolute =
      typeof window !== "undefined"
        ? `${window.location.origin}${shareMapHref}`
        : shareMapHref;
    try {
      await navigator.clipboard.writeText(absolute);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Clipboard denied — still offer the openable link below.
    }
  }

  function addToCalendar() {
    const crawl = {
      id: crawlId || crawlTitle,
      title: crawlTitle,
      blurb: crawlBlurb,
      stopNoun,
      stops: route.map((venue) => ({ name: venue.name, address: venue.address })),
    };
    downloadIcs(icsFilename(crawl), buildCrawlIcs(crawl));
  }

  return (
    <aside className="routePanel">
      <div className="routeHeader">
        <div>
          <p className="eyebrow">{mode === "build" ? "Your Crawl" : "Suggested Crawl"}</p>
          <h2>
            {mode === "build"
              ? crawlName || "Hand-built route"
              : `${styleLabels[crawlStyle]} route`}
          </h2>
          {crawlBlurb ? (
            <p className="description muted" style={{ margin: "4px 0 0" }}>
              {crawlBlurb}
            </p>
          ) : null}
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

      <div
        className="altStylePicker"
        role="radiogroup"
        aria-label="Crawl style"
        data-testid="alt-style-picker"
      >
        {ALT_CRAWL_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            role="radio"
            aria-checked={altStyle === style}
            className={altStyle === style ? "altStyleBtn active" : "altStyleBtn"}
            onClick={() => onAltStyleChange(style)}
          >
            {altStyleLabels[style]}
          </button>
        ))}
      </div>

      <div className="routeMetrics">
        <div>
          <BadgePoundSterling size={17} />
          <span>{formatPrice(summary.total)}</span>
          <small>estimated round</small>
        </div>
        <div
          title="Haversine (straight-line) distance between stops. Walking distance will be longer."
        >
          <MapPin size={17} />
          <span>{summary.distance.toFixed(1)} km</span>
          <small>straight-line, between stops</small>
        </div>
        {legSummary.legs.length > 0 ? (
          <div
            title="Estimated at 4.8 km/h (walking) or 9 km/h (running), over the same straight-line distance. Real pavement time will be longer."
          >
            <Footprints size={17} />
            <span>{legSummary.totalMinutes} min</span>
            <small>{pace === "run" ? "running, straight-line" : "walking, straight-line"}</small>
          </div>
        ) : null}
        <div>
          <Trophy size={17} />
          <span>{route.length}</span>
          <small>{route.length === 1 ? stopNoun : `${stopNoun}s`}</small>
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

      {mode === "build" && route.length >= 2 && onReverseRoute ? (
        <button
          type="button"
          className="addStopBtn"
          style={{ marginTop: 0, marginBottom: "12px" }}
          onClick={onReverseRoute}
        >
          <ArrowUpDown size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} /> Reverse
          route
        </button>
      ) : null}

      {legSummary.legs.length > 0 ? (
        <div className="routePace" role="group" aria-label="Walking or running pace">
          <button
            type="button"
            className={pace === "walk" ? "routePaceBtn active" : "routePaceBtn"}
            aria-pressed={pace === "walk"}
            onClick={() => setPace("walk")}
          >
            Walk
          </button>
          <button
            type="button"
            className={pace === "run" ? "routePaceBtn active" : "routePaceBtn"}
            aria-pressed={pace === "run"}
            onClick={() => setPace("run")}
          >
            Run
          </button>
          <span className="routePaceTotal">{formatRouteTotal(legSummary)}</span>
        </div>
      ) : null}

      {route.length >= 2 ? (
        <div className={routeMapped ? "routeMapPrompt active" : "routeMapPrompt"}>
          <div>
            <strong>{routeMapped ? "Mapped on London" : "Map this crawl?"}</strong>
            <span>
              {legSummary.totalKm.toFixed(1)} km, {legSummary.totalMinutes} min walk,
              straight-line.
            </span>
            {typeof originDistanceKm === "number" ? (
              <small>From you: {originDistanceKm.toFixed(1)} km to the first stop.</small>
            ) : null}
          </div>
          <button
            type="button"
            onClick={routeMapped ? onHideRoute : onMapRoute}
            aria-pressed={routeMapped}
          >
            <Route size={14} aria-hidden="true" />
            {routeMapped ? "Hide line" : "Map route"}
          </button>
        </div>
      ) : null}

      {route.length >= 1 ? (
        <button
          type="button"
          className="addStopBtn calendarBtn"
          onClick={addToCalendar}
          data-testid="add-to-calendar"
        >
          <CalendarPlus size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Add to calendar (.ics)
        </button>
      ) : null}

      {route.length >= 2 && onCheckLastTrain ? (
        <button
          type="button"
          className="addStopBtn trainRouteBtn"
          onClick={onCheckLastTrain}
          data-testid="check-last-train"
        >
          <TrainFront size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
          Check last train at final stop
        </button>
      ) : null}

      {route.length >= 2 ? (
        <div className="crawlProgressRow" data-testid="crawl-progress">
          {!crawlProgress ? (
            <button type="button" className="addStopBtn" onClick={handleStartCrawl}>
              <Footprints size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
              Start this crawl
            </button>
          ) : crawlDone ? (
            <p className="crawlProgressDone" role="status">
              Crawl complete — {crawlProgress.visited.length}/{crawlProgress.stopIds.length} stops
            </p>
          ) : (
            <>
              <p className="crawlProgressStatus" role="status">
                Walking · {crawlProgress.visited.length}/{crawlProgress.stopIds.length} stops
              </p>
              <button type="button" className="addStopBtn" onClick={handleMarkComplete}>
                <Check size={14} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
                Mark complete
              </button>
            </>
          )}
          {showCelebration ? (
            <div
              className="crawlCelebration"
              role="status"
              data-testid="crawl-celebration"
            >
              <p className="crawlCelebrationTitle">You walked it</p>
              <p className="crawlCelebrationCopy">
                {placeStoryBandId
                  ? "Place story complete — drop a memory, share the route, or stamp your passport."
                  : "Crawl complete — drop a memory, share the route, or stamp your passport."}
              </p>
              <div className="crawlCelebrationActions">
                <Link className="crawlCelebrationLink" href={dropHref}>
                  Drop a pint
                </Link>
                <button
                  type="button"
                  className="crawlCelebrationLink crawlCelebrationCopyBtn"
                  onClick={() => void copyShareLink()}
                  data-testid="crawl-share-copy"
                >
                  {shareCopied ? "Link copied" : "Copy link"}
                </button>
                <Link
                  className="crawlCelebrationLink"
                  href={shareMapHref}
                  data-testid="crawl-share-open"
                >
                  Open shared crawl
                </Link>
                <Link className="crawlCelebrationLink" href="/u/you">
                  View passport
                </Link>
              </div>
              <button
                type="button"
                className="crawlCelebrationDismiss"
                onClick={() => setShowCelebration(false)}
              >
                Not now
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {route.length >= 2 ? (
        <SaveCrawlStory
          stops={route.map((venue) => ({
            venueId: venue.id,
            name: venue.name,
            // The route's representative per-stop price (same signal the metrics
            // total uses) — the cheapest listed pint at that venue.
            priceGbp: venue.cheapestPrice,
          }))}
          defaultTitle={
            mode === "build"
              ? crawlName || "My hand-built crawl"
              : `${styleLabels[crawlStyle]} crawl`
          }
        />
      ) : null}

      <ol className="routeList">
        {route.map((venue, index) => {
          const signal = venueSignals.get(venue.id);
          const dropCount = signal?.dropCount ?? 0;
          const leg = legSummary.legs[index];
          const onTheWay = onTheWayByLeg.get(index) ?? [];
          return (
          <li key={venue.id} className={activeVenueId === venue.id ? "active" : ""}>
            <button
              type="button"
              onClick={() => onSelectVenue(venue.id)}
              aria-current={activeVenueId === venue.id ? "true" : undefined}
            >
              <span className="stopNumber">{index + 1}</span>
              <div>
                <strong>
                  {venue.name}
                  {dropCount > 0 ? (
                    <span
                      className="provChip contributor"
                      style={{ marginLeft: "6px", verticalAlign: "middle" }}
                      title={`${dropCount} Pint Drop${dropCount === 1 ? "" : "s"} logged here`}
                    >
                      <Beer size={11} aria-hidden="true" />
                      {dropCount}
                    </span>
                  ) : null}
                </strong>
                <p>
                  {formatPrice(signal?.latestContributorPrice ?? venue.cheapestPrice)}{" "}
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
            {leg ? (
              <div className="routeLeg" aria-label={`Leg to ${leg.to.name}`}>
                <Footprints size={13} aria-hidden="true" />
                <span>{formatLeg(leg)}</span>
                {onTheWay.length > 0 ? (
                  <p className="routeLegOnWay">
                    On the way: {onTheWay.map((m) => m.poi.name).join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </li>
          );
        })}
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
