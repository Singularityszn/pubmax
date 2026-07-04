"use client";

import {
  Anchor,
  BadgePoundSterling,
  Beer,
  BookOpen,
  Camera,
  ExternalLink,
  Landmark,
  MapPin,
  Route,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Waves,
  Hand,
  Trash2,
  PlusCircle,
  Send,
  Quote,
  ImagePlus,
  X,
  Flag,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  buildCrawlRoute,
  crawlSummary,
  filterVenues,
  formatPrice,
  groupVenuePrices,
  type CrawlStyle,
  type Filters,
  type Venue,
  type VenuePrice,
} from "@/lib/venues";
import {
  buildVenueClaims,
  pubSources,
  writerProfile,
  type ClaimKind,
  type Provenance,
} from "@/lib/curation";
import type { PintDrop } from "@/lib/pintDrops";
import PubMapCanvas from "@/components/PubMapCanvas";
import LandlordPanel from "@/components/LandlordPanel";

type CrawlMode = "suggest" | "build";

// The API DTO now carries photo URLs on every drop; lib/pintDrops owns the base
// shape, so we augment it here at the client boundary rather than editing lib/*.
type DropWithPhotos = PintDrop & {
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
};

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB — server re-validates.
const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

type PhotoSlot = { file: File; previewUrl: string };

const PROVENANCE_LABEL: Record<Provenance, string> = {
  sourced: "Sourced",
  contributor: "Contributor",
  anecdote: "Anecdote",
};

function ProvenanceChip({ provenance }: { provenance: Provenance }) {
  return <span className={`provChip ${provenance}`}>{PROVENANCE_LABEL[provenance]}</span>;
}

const CLAIM_KIND_LABEL: Record<ClaimKind, string> = {
  baseline: "Baseline",
  sourced: "Sourced",
  contributor: "Contributor",
  anecdote: "Anecdote",
  "needs-source": "Needs Source",
};

// Reuses .provChip; needs-source/baseline get their own colour classes in CSS.
function ClaimBadge({ kind }: { kind: ClaimKind }) {
  return <span className={`provChip ${kind}`}>{CLAIM_KIND_LABEL[kind]}</span>;
}

const styleLabels: Record<CrawlStyle, string> = {
  balanced: "Balanced",
  cheapest: "Cheapest",
  heritage: "Historic",
  writerTrail: "Writer Trail",
  beerGarden: "Beer Garden",
  sports: "Live Sports",
  dateNight: "Date Night",
};

const initialFilters: Filters = {
  query: "",
  maxPrice: 7,
  crawlStyle: "balanced",
  stopCount: 6,
  routeWindow: 20,
  requireBeerGarden: false,
  requireLiveSports: false,
  requireFood: false,
  requireCocktails: false,
  requireWater: false,
  requireHeritage: false,
  canonicalOnly: true,
};

function Amenity({ active, label }: { active: boolean; label: string }) {
  return <span className={active ? "amenity active" : "amenity"}>{label}</span>;
}

function groupDropsByVenueId(drops: DropWithPhotos[]): Map<string, DropWithPhotos[]> {
  const grouped = new Map<string, DropWithPhotos[]>();
  for (const drop of drops) {
    grouped.set(drop.venueId, [...(grouped.get(drop.venueId) ?? []), drop]);
  }
  return grouped;
}

// Fold Pint Drops into the venue's DERIVED SUMMARY SIGNALS only — never into the
// editorial curation note. A contributor price can update cheapestPrice/Pint and
// a passed-down note lights hasStory, but the claims themselves stay distinct and
// are rendered separately via buildVenueClaims. This is what keeps a Sourced
// editorial claim from being buried under an Anecdote drop.
function mergeVenueDrops(
  venues: Venue[],
  dropsByVenueId: Map<string, DropWithPhotos[]>,
): Venue[] {
  if (dropsByVenueId.size === 0) return venues;
  return venues.map((venue) => {
    const venueDrops = dropsByVenueId.get(venue.id) ?? [];
    if (venueDrops.length === 0) return venue;

    const latestPriceDrop = venueDrops.find((drop) => typeof drop.priceGbp === "number");
    const contributorPrice = latestPriceDrop?.priceGbp ?? null;
    const cheapestPrice =
      contributorPrice === null
        ? venue.cheapestPrice
        : Math.min(venue.cheapestPrice ?? Number.POSITIVE_INFINITY, contributorPrice);

    return {
      ...venue,
      cheapestPrice,
      cheapestPint: latestPriceDrop?.drink || venue.cheapestPint,
      // Any Pint Drop is a story signal — no drop text overwrites curation.
      hasStory: venue.hasStory || venueDrops.length > 0,
    };
  });
}

export default function PubMap() {
  const [rows, setRows] = useState<VenuePrice[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string>("");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [mode, setMode] = useState<CrawlMode>("suggest");
  const [builtIds, setBuiltIds] = useState<string[]>([]);

  // Community Pint Drops for the currently-inspected venue.
  const [handle, setHandle] = useState(() =>
    typeof window === "undefined" ? "" : (window.localStorage.getItem("pubmax_handle") ?? ""),
  );
  const [dropsByVenueId, setDropsByVenueId] = useState<Map<string, DropWithPhotos[]>>(
    () => new Map(),
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [dropForm, setDropForm] = useState({ price: "", drink: "", note: "", era: "" });
  const [pintPhoto, setPintPhoto] = useState<PhotoSlot | null>(null);
  const [venuePhoto, setVenuePhoto] = useState<PhotoSlot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dropMsg, setDropMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pintInputRef = useRef<HTMLInputElement>(null);
  const venueInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/data/pint_prices_app_dataset.json")
      .then((response) => response.json())
      .then((data: VenuePrice[]) => setRows(data));
  }, []);

  useEffect(() => {
    fetch("/api/pint-drops")
      .then((response) => (response.ok ? response.json() : { drops: [] }))
      .then((data: { drops?: DropWithPhotos[] }) =>
        setDropsByVenueId(groupDropsByVenueId(data.drops ?? [])),
      )
      .catch(() => setDropsByVenueId(new Map()));
  }, []);

  const baseVenues = useMemo(() => groupVenuePrices(rows), [rows]);
  const venues = useMemo(
    () => mergeVenueDrops(baseVenues, dropsByVenueId),
    [baseVenues, dropsByVenueId],
  );
  const venueById = useMemo(() => new Map(venues.map((v) => [v.id, v])), [venues]);
  const filteredVenues = useMemo(() => filterVenues(venues, filters), [venues, filters]);

  const suggestedRoute = useMemo(
    () => buildCrawlRoute(filteredVenues, filters),
    [filteredVenues, filters],
  );
  const builtRoute = useMemo(
    () => builtIds.map((id) => venueById.get(id)).filter((v): v is Venue => Boolean(v)),
    [builtIds, venueById],
  );
  const route = mode === "suggest" ? suggestedRoute : builtRoute;
  const summary = useMemo(() => crawlSummary(route), [route]);

  const selectedVenue = useMemo(
    () => venueById.get(selectedVenueId) ?? route[0],
    [route, selectedVenueId, venueById],
  );
  const cheapCount = filteredVenues.filter(
    (venue) => venue.cheapestPrice !== null && venue.cheapestPrice <= 5.5,
  ).length;
  const waterCount = filteredVenues.filter((venue) => venue.curation.nearWater).length;
  const heritageCount = filteredVenues.filter((venue) => venue.hasStory).length;
  const writerCount = filteredVenues.filter((venue) => venue.curation.writerPick).length;
  const routeWaterCount = route.filter((venue) => venue.curation.nearWater).length;
  const routeHeritageCount = route.filter((venue) => venue.hasStory).length;
  const routeWriterCount = route.filter((venue) => venue.curation.writerPick).length;
  const drops = useMemo(
    () => (selectedVenue ? (dropsByVenueId.get(selectedVenue.id) ?? []) : []),
    [selectedVenue, dropsByVenueId],
  );
  // The distinct, provenance-stamped claim list for the inspected venue.
  // Editorial Sourced claims and contributor/anecdote drops stay separate.
  const claims = useMemo(
    () => (selectedVenue ? buildVenueClaims(selectedVenue.curation, drops) : []),
    [selectedVenue, drops],
  );
  const venueSignals = useMemo(() => {
    const signals = new Map<string, { hasPintDrops: boolean; latestContributorPrice: number | null }>();
    for (const [venueId, venueDrops] of dropsByVenueId) {
      const latestContributorPrice =
        venueDrops.find((drop) => typeof drop.priceGbp === "number")?.priceGbp ?? null;
      signals.set(venueId, {
        hasPintDrops: venueDrops.length > 0,
        latestContributorPrice,
      });
    }
    return signals;
  }, [dropsByVenueId]);

  const filtersDirty = useMemo(
    () => JSON.stringify(filters) !== JSON.stringify(initialFilters),
    [filters],
  );
  function resetFilters() {
    setFilters({ ...initialFilters, crawlStyle: filters.crawlStyle });
  }

  // Load the venue's community Pint Drops whenever the inspected venue changes.
  const selectedId = selectedVenue?.id;
  useEffect(() => {
    if (!selectedId) {
      return;
    }
    let active = true;
    fetch(`/api/pint-drops?venueId=${encodeURIComponent(selectedId)}`)
      .then((response) => (response.ok ? response.json() : { drops: [] }))
      .then((data: { drops?: DropWithPhotos[] }) => {
        if (active) {
          setDropsByVenueId((current) => {
            const next = new Map(current);
            next.set(selectedId, data.drops ?? []);
            return next;
          });
        }
      })
      .catch(() => {
        if (active) {
          setDropsByVenueId((current) => {
            const next = new Map(current);
            next.set(selectedId, []);
            return next;
          });
        }
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  // Pick a photo for one slot: pre-validate (type + size) before we ever build a
  // preview or submit, so bad files are caught client-side. Object URLs are
  // revoked when the slot is replaced/removed and on unmount (effect below).
  function pickPhoto(
    file: File | undefined,
    setSlot: (slot: PhotoSlot | null) => void,
    current: PhotoSlot | null,
    inputEl: HTMLInputElement | null,
  ) {
    if (!file) return;
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setDropMsg({ ok: false, text: "Photos must be JPEG, PNG, or WebP." });
      if (inputEl) inputEl.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setDropMsg({ ok: false, text: "Each photo must be under 5MB." });
      if (inputEl) inputEl.value = "";
      return;
    }
    if (current) URL.revokeObjectURL(current.previewUrl);
    setDropMsg(null);
    setSlot({ file, previewUrl: URL.createObjectURL(file) });
  }

  function removePhoto(
    setSlot: (slot: PhotoSlot | null) => void,
    current: PhotoSlot | null,
    inputEl: HTMLInputElement | null,
  ) {
    if (current) URL.revokeObjectURL(current.previewUrl);
    setSlot(null);
    if (inputEl) inputEl.value = "";
  }

  function resetComposer() {
    if (pintPhoto) URL.revokeObjectURL(pintPhoto.previewUrl);
    if (venuePhoto) URL.revokeObjectURL(venuePhoto.previewUrl);
    setPintPhoto(null);
    setVenuePhoto(null);
    setDropForm({ price: "", drink: "", note: "", era: "" });
    if (pintInputRef.current) pintInputRef.current.value = "";
    if (venueInputRef.current) venueInputRef.current.value = "";
  }

  // Revoke any live preview URLs when the component unmounts.
  useEffect(() => {
    return () => {
      if (pintPhoto) URL.revokeObjectURL(pintPhoto.previewUrl);
      if (venuePhoto) URL.revokeObjectURL(venuePhoto.previewUrl);
    };
  }, [pintPhoto, venuePhoto]);

  async function submitDrop(event: FormEvent) {
    event.preventDefault();
    if (!selectedVenue) return;
    setSubmitting(true);
    setDropMsg(null);
    try {
      // multipart/form-data — do NOT set Content-Type, the browser adds the boundary.
      const body = new FormData();
      body.set("venueId", selectedVenue.id);
      body.set("handle", handle);
      body.set("drink", dropForm.drink);
      body.set("priceGbp", dropForm.price);
      body.set("passedDownNote", dropForm.note);
      body.set("era", dropForm.era);
      if (pintPhoto) body.set("pint_photo", pintPhoto.file);
      if (venuePhoto) body.set("venue_photo", venuePhoto.file);

      const response = await fetch("/api/pint-drops", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) {
        setDropMsg({ ok: false, text: data.error ?? "Could not save that drop." });
      } else {
        window.localStorage.setItem("pubmax_handle", handle.trim());
        setDropsByVenueId((current) => {
          const next = new Map(current);
          next.set(selectedVenue.id, [data.drop, ...(next.get(selectedVenue.id) ?? [])]);
          return next;
        });
        resetComposer();
        setComposerOpen(false);
        setDropMsg({ ok: true, text: "Cheers — your Pint Drop is live." });
      }
    } catch {
      setDropMsg({ ok: false, text: "Network or storage error — try again." });
    } finally {
      setSubmitting(false);
    }
  }

  async function reportDrop(id: string) {
    if (!selectedVenue) return;
    const venueId = selectedVenue.id;
    // Optimistic remove — moderation is minimal, no reason UI.
    setDropsByVenueId((current) => {
      const next = new Map(current);
      next.set(venueId, (next.get(venueId) ?? []).filter((drop) => drop.id !== id));
      return next;
    });
    try {
      await fetch("/api/pint-drops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "report", id }),
      });
    } catch {
      // ponytail: swallow — the drop is already hidden locally; a failed report
      // just means it reappears on next load, which is acceptable for demo moderation.
    }
  }

  const selectVenue = useCallback(
    (id: string) => {
      setSelectedVenueId(id);
      setDropMsg(null);
      setComposerOpen(false);
    },
    [],
  );

  const toggleBuiltStop = useCallback((id: string) => {
    setBuiltIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
  }, []);

  const handleVenueClick = useCallback(
    (id: string) => {
      selectVenue(id);
      if (mode === "build") toggleBuiltStop(id);
    },
    [mode, selectVenue, toggleBuiltStop],
  );

  return (
    <main className="appShell dark">
      <aside className="controlRail">
        <div className="brandBlock">
          <div className="brandMark">
            <Beer size={22} />
          </div>
          <div>
            <p className="eyebrow">PubMaxing</p>
            <h1>Design the right London pub crawl.</h1>
          </div>
        </div>

        <div className="modeToggle">
          <button
            className={mode === "suggest" ? "selected" : ""}
            onClick={() => setMode("suggest")}
          >
            <Sparkles size={15} /> Suggest a crawl
          </button>
          <button className={mode === "build" ? "selected" : ""} onClick={() => setMode("build")}>
            <Hand size={15} /> Build your own
          </button>
        </div>

        {mode === "build" ? (
          <p className="buildHint">
            Tap pubs on the map to add or remove them. Use the route list to inspect stops.{" "}
            {builtIds.length} stop{builtIds.length === 1 ? "" : "s"} picked.
            {builtIds.length > 0 ? (
              <button className="clearBtn" onClick={() => setBuiltIds([])}>
                <Trash2 size={13} /> Clear
              </button>
            ) : null}
          </p>
        ) : null}

        <label className="searchBox">
          <Search size={18} />
          <input
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder="Search Shoreditch, Hackney, pub name..."
          />
        </label>

        {mode === "suggest" ? (
          <section className="panelSection">
            <div className="sectionTitle">
              <SlidersHorizontal size={16} />
              <span>Crawl Style</span>
            </div>
            <div className="segmented">
              {(Object.keys(styleLabels) as CrawlStyle[]).map((style) => (
                <button
                  key={style}
                  className={filters.crawlStyle === style ? "selected" : ""}
                  onClick={() => setFilters({ ...filters, crawlStyle: style })}
                >
                  {styleLabels[style]}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="panelSection">
          <div className="rangeLine">
            <span>Max Pint</span>
            <strong>£{filters.maxPrice.toFixed(2)}</strong>
          </div>
          <input
            type="range"
            min="4"
            max="9"
            step="0.25"
            value={filters.maxPrice}
            onChange={(event) => setFilters({ ...filters, maxPrice: Number(event.target.value) })}
          />
          {mode === "suggest" ? (
            <>
              <div className="rangeLine">
                <span>Stops</span>
                <strong>{filters.stopCount}</strong>
              </div>
              <input
                type="range"
                min="4"
                max="7"
                step="1"
                value={filters.stopCount}
                onChange={(event) =>
                  setFilters({ ...filters, stopCount: Number(event.target.value) })
                }
              />
              <div className="rangeLine">
                <span>Route Window</span>
                <strong>{filters.routeWindow} min</strong>
              </div>
              <input
                type="range"
                min="15"
                max="30"
                step="5"
                value={filters.routeWindow}
                onChange={(event) =>
                  setFilters({ ...filters, routeWindow: Number(event.target.value) })
                }
              />
            </>
          ) : null}
        </section>

        <section className="panelSection toggles">
          <div className="sectionTitle">
            <Landmark size={16} />
            <span>Story Filters</span>
            {filtersDirty ? (
              <button className="resetBtn" style={{ marginLeft: "auto" }} onClick={resetFilters}>
                <Trash2 size={12} /> Reset
              </button>
            ) : null}
          </div>
          <label>
            <input
              type="checkbox"
              checked={filters.requireWater}
              onChange={(event) => setFilters({ ...filters, requireWater: event.target.checked })}
            />
            By the water
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.requireHeritage}
              onChange={(event) =>
                setFilters({ ...filters, requireHeritage: event.target.checked })
              }
            />
            Heritage note
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.requireBeerGarden}
              onChange={(event) =>
                setFilters({ ...filters, requireBeerGarden: event.target.checked })
              }
            />
            Beer garden
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.requireLiveSports}
              onChange={(event) =>
                setFilters({ ...filters, requireLiveSports: event.target.checked })
              }
            />
            Live sports
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.requireFood}
              onChange={(event) => setFilters({ ...filters, requireFood: event.target.checked })}
            />
            Food
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.requireCocktails}
              onChange={(event) =>
                setFilters({ ...filters, requireCocktails: event.target.checked })
              }
            />
            Cocktails
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.canonicalOnly}
              onChange={(event) => setFilters({ ...filters, canonicalOnly: event.target.checked })}
            />
            Clean borough rows
          </label>
        </section>

        <section className="statsGrid">
          <div>
            <span>Matched</span>
            <strong>{filteredVenues.length}</strong>
          </div>
          <div>
            <span>≤ £5.50</span>
            <strong>{cheapCount}</strong>
          </div>
          <div>
            <span>Water</span>
            <strong>{waterCount}</strong>
          </div>
          <div>
            <span>Heritage</span>
            <strong>{heritageCount}</strong>
          </div>
          <div>
            <span>Writer</span>
            <strong>{writerCount}</strong>
          </div>
        </section>

        {filteredVenues.length === 0 ? (
          <section className="emptyState">
            <strong>No venues match</strong>
            <p>Try widening the pint price or clearing story and amenity filters.</p>
            <button onClick={() => setFilters(initialFilters)}>Reset filters</button>
          </section>
        ) : null}

        <section className="writerCard">
          <div className="writerHeader">
            <Camera size={18} />
            <div>
              <p className="eyebrow">{writerProfile.handle}</p>
              <h2>{writerProfile.name}</h2>
            </div>
          </div>
          <p>{writerProfile.summary}</p>
          <div className="writerFacts">
            <span>
              <BookOpen size={15} />
              {writerProfile.bookTitle}
            </span>
            <span>
              <Anchor size={15} />
              Narrowboat London
            </span>
          </div>
          <ul>
            {writerProfile.proofPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
          <div className="sourceLinks">
            {pubSources.map((source) => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
                {source.title}
                <ExternalLink size={13} />
              </a>
            ))}
          </div>
        </section>
      </aside>

      <section className="mapStage">
        <PubMapCanvas
          venues={filteredVenues}
          route={route}
          selectedVenueId={selectedVenueId}
          onVenueClick={handleVenueClick}
          onRouteStopClick={selectVenue}
          venueSignals={venueSignals}
        />
        <div className="mapLegend">
          <span>
            <i className="green" /> ≤ £5.50
          </span>
          <span>
            <i className="amber" /> £5.50-£7
          </span>
          <span>
            <i className="red" /> £7+
          </span>
          <span>
            <i className="blue" /> heritage
          </span>
          <span>
            <i className="gold" /> writer
          </span>
        </div>
      </section>

      <aside className="routePanel">
        <div className="routeHeader">
          <div>
            <p className="eyebrow">{mode === "build" ? "Your Crawl" : "Suggested Crawl"}</p>
            <h2>
              {mode === "build" ? "Hand-built route" : `${styleLabels[filters.crawlStyle]} route`}
            </h2>
          </div>
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
              ? "No stops yet. Tap pubs on the map to start your crawl."
              : "No suggested route matches these filters. Reset filters or widen the route window."}
          </p>
        ) : null}

        <ol className="routeList">
          {route.map((venue, index) => (
            <li
              key={venue.id}
              className={selectedVenue?.id === venue.id ? "active" : ""}
              onClick={() => selectVenue(venue.id)}
            >
              <span className="stopNumber">{index + 1}</span>
              <div>
                <strong>{venue.name}</strong>
                <p>
                  {formatPrice(venueSignals.get(venue.id)?.latestContributorPrice ?? venue.cheapestPrice)} ·{" "}
                  {venue.cheapestPint}
                </p>
                <small>
                  {venue.curation.storyTag ||
                    venue.primaryBorough ||
                    venue.visibleBoroughs[0] ||
                    "London"}
                </small>
              </div>
            </li>
          ))}
        </ol>

        {selectedVenue ? (
          <section className="venueInspector">
            <div className="inspectorTitle">
              <Waves size={17} />
              <span>Venue Detail</span>
            </div>
            <h3>{selectedVenue.name}</h3>
            <p>{selectedVenue.address}</p>
            <div className="amenityRow">
              <Amenity active={Boolean(selectedVenue.curation.nearWater)} label="water" />
              <Amenity active={selectedVenue.hasStory} label="heritage" />
              <Amenity active={Boolean(selectedVenue.curation.writerPick)} label="writer" />
              <Amenity active={selectedVenue.amenities.beerGarden} label="garden" />
              <Amenity active={selectedVenue.amenities.liveSports} label="sports" />
              <Amenity active={selectedVenue.amenities.food} label="food" />
              <Amenity active={selectedVenue.amenities.cocktails} label="cocktails" />
              <Amenity active={selectedVenue.amenities.pubQuiz} label="quiz" />
            </div>
            {venueSignals.get(selectedVenue.id)?.latestContributorPrice !== null &&
            venueSignals.get(selectedVenue.id)?.latestContributorPrice !== undefined ? (
              <div className="contributorPrice">
                <span>Latest Pint Drop price</span>
                <strong>
                  {formatPrice(venueSignals.get(selectedVenue.id)?.latestContributorPrice ?? null)}
                </strong>
              </div>
            ) : null}
            {mode === "build" ? (
              <button
                className="addStopBtn"
                onClick={() => toggleBuiltStop(selectedVenue.id)}
              >
                {builtIds.includes(selectedVenue.id) ? "Remove from crawl" : "Add to crawl"}
              </button>
            ) : null}
            {selectedVenue.description ? (
              <p className="description">{selectedVenue.description}</p>
            ) : (
              <p className="description muted">
                No heritage note yet. This is where visit reports and venue research will add
                character.
              </p>
            )}
            {claims.length > 0 ? (
              <div className="claimList">
                {claims.map((claim, index) => (
                  <div key={`${claim.kind}-${index}`} className="claimCard">
                    <div className="claimHead">
                      <span className="claimEra">{claim.era ?? claim.label}</span>
                      <ClaimBadge kind={claim.kind} />
                    </div>
                    <p>{claim.content}</p>
                    {claim.sourceRef ? (
                      <a href={claim.sourceRef} target="_blank" rel="noreferrer">
                        {claim.label}
                        <ExternalLink size={13} />
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="priceList">
              {selectedVenue.prices.slice(0, 6).map((price) => (
                <div key={price.app_price_id}>
                  <span>{price.pint_name}</span>
                  <strong>{formatPrice(price.price_gbp)}</strong>
                </div>
              ))}
            </div>

            <section className="pintDrops">
              <div className="inspectorTitle">
                <Quote size={16} />
                <span>Pint Drops</span>
              </div>
              {drops.length === 0 ? (
                <p className="description muted">
                  No Pint Drops yet — be the first to log a price or pass down a story.
                </p>
              ) : (
                <div className="dropList">
                  {drops.map((drop) => (
                    <article key={drop.id} className="dropCard">
                      <div className="dropHead">
                        <span className="dropHandle">{drop.handle}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          {drop.priceGbp !== null ? (
                            <span className="dropPrice">{formatPrice(drop.priceGbp)}</span>
                          ) : null}
                          <ProvenanceChip provenance={drop.provenance} />
                        </span>
                      </div>
                      {drop.pintPhotoUrl || drop.venuePhotoUrl ? (
                        <div className="dropPhotos">
                          {drop.pintPhotoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="dropPhoto"
                              src={drop.pintPhotoUrl}
                              alt={`Pint at ${selectedVenue.name} shared by ${drop.handle}`}
                              loading="lazy"
                            />
                          ) : null}
                          {drop.venuePhotoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              className="dropPhoto"
                              src={drop.venuePhotoUrl}
                              alt={`View of ${selectedVenue.name} shared by ${drop.handle}`}
                              loading="lazy"
                            />
                          ) : null}
                        </div>
                      ) : null}
                      {drop.passedDownNote ? <p>{drop.passedDownNote}</p> : null}
                      <div className="dropFoot">
                        <small>
                          {[drop.drink, drop.era].filter(Boolean).join(" · ") || "Visit report"}
                        </small>
                        <button
                          type="button"
                          className="reportBtn"
                          onClick={() => reportDrop(drop.id)}
                          aria-label={`Report Pint Drop by ${drop.handle}`}
                        >
                          <Flag size={12} /> Report
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {composerOpen ? (
                <form className="dropComposer" onSubmit={submitDrop}>
                  <input
                    value={handle}
                    onChange={(event) => setHandle(event.target.value)}
                    placeholder="Your handle (e.g. @thirsty_ted)"
                    aria-label="Contributor handle"
                    required
                  />
                  <div className="composerRow">
                    <input
                      value={dropForm.price}
                      onChange={(event) => setDropForm({ ...dropForm, price: event.target.value })}
                      placeholder="Price £"
                      inputMode="decimal"
                      aria-label="Pint price in pounds"
                    />
                    <input
                      value={dropForm.drink}
                      onChange={(event) => setDropForm({ ...dropForm, drink: event.target.value })}
                      placeholder="Drink"
                      aria-label="Drink name"
                    />
                  </div>
                  <textarea
                    value={dropForm.note}
                    onChange={(event) => setDropForm({ ...dropForm, note: event.target.value })}
                    placeholder="Passed-down note — a memory, a story, why this pub matters…"
                    aria-label="Passed-down note"
                  />
                  <input
                    value={dropForm.era}
                    onChange={(event) => setDropForm({ ...dropForm, era: event.target.value })}
                    placeholder="Era (e.g. 1970s, my childhood)"
                    aria-label="Era this memory belongs to"
                  />

                  <div className="photoRow">
                    <div className="photoField">
                      {pintPhoto ? (
                        <div className="photoPreview">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={pintPhoto.previewUrl} alt="Preview of your pint photo" />
                          <button
                            type="button"
                            className="photoRemove"
                            onClick={() => removePhoto(setPintPhoto, pintPhoto, pintInputRef.current)}
                            aria-label="Remove pint photo"
                          >
                            <X size={13} /> Remove
                          </button>
                        </div>
                      ) : (
                        <label className="photoPick">
                          <ImagePlus size={16} />
                          <span>Your pint</span>
                          <input
                            ref={pintInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            capture="environment"
                            onChange={(event) =>
                              pickPhoto(
                                event.target.files?.[0],
                                setPintPhoto,
                                pintPhoto,
                                event.target,
                              )
                            }
                          />
                        </label>
                      )}
                    </div>
                    <div className="photoField">
                      {venuePhoto ? (
                        <div className="photoPreview">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={venuePhoto.previewUrl} alt="Preview of your pub photo" />
                          <button
                            type="button"
                            className="photoRemove"
                            onClick={() =>
                              removePhoto(setVenuePhoto, venuePhoto, venueInputRef.current)
                            }
                            aria-label="Remove pub photo"
                          >
                            <X size={13} /> Remove
                          </button>
                        </div>
                      ) : (
                        <label className="photoPick">
                          <ImagePlus size={16} />
                          <span>The pub</span>
                          <input
                            ref={venueInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            capture="environment"
                            onChange={(event) =>
                              pickPhoto(
                                event.target.files?.[0],
                                setVenuePhoto,
                                venuePhoto,
                                event.target,
                              )
                            }
                          />
                        </label>
                      )}
                    </div>
                  </div>

                  <p className="consentNote">
                    Photos and notes are public and may show people. Only upload what you&rsquo;re
                    happy to share.
                  </p>

                  <div className="composerActions">
                    <button type="submit" disabled={submitting}>
                      <Send size={14} /> {submitting ? "Posting…" : "Post Pint Drop"}
                    </button>
                    {dropMsg ? (
                      <span className={`composerMsg ${dropMsg.ok ? "ok" : "error"}`}>
                        {dropMsg.text}
                      </span>
                    ) : null}
                  </div>
                </form>
              ) : (
                <>
                  <button className="composerToggle" onClick={() => setComposerOpen(true)}>
                    <PlusCircle size={16} /> Log a Pint Drop
                  </button>
                  {dropMsg ? (
                    <span
                      className={`composerMsg ${dropMsg.ok ? "ok" : "error"}`}
                      style={{ display: "block", marginTop: "8px" }}
                    >
                      {dropMsg.text}
                    </span>
                  ) : null}
                </>
              )}
            </section>

            <LandlordPanel
              venueId={selectedVenue.id}
              venueName={selectedVenue.name}
              context={{
                era: selectedVenue.curation.heritageEra,
                heritageNote: selectedVenue.curation.heritageNote,
                address: selectedVenue.address,
                borough: selectedVenue.primaryBorough,
              }}
            />
          </section>
        ) : null}
      </aside>
    </main>
  );
}
