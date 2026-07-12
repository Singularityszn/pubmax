"use client";

import Image from "next/image";
import Link from "next/link";
import {
  BookOpen,
  ExternalLink,
  Flag,
  MapPin,
  PlusCircle,
  Quote,
  Route as RouteIcon,
  Share2,
  TrainFront,
  Waves,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import {
  COMMUNITY_PRICE_NOTE,
  formatFreshness,
  formatObservedAt,
  formatPrice,
  type Venue,
} from "@/lib/venues";
import { buildVenueClaims, type ClaimKind, type Provenance } from "@/lib/curation";
import type { PricedVenue } from "@/lib/priceUpdates";
import {
  accessibilityChipLabels,
  quietHoursLabel,
} from "@/lib/venueAccessibility";
import LandlordPanel from "@/components/LandlordPanel";
import LastTrainCard from "./LastTrainCard";
import PintDropComposer from "@/components/map/PintDropComposer";
import VenuePriceStory from "@/components/map/VenuePriceStory";
import SaveToListControl from "@/components/savedpubs/SaveToListControl";
import NextBadgeChips from "@/components/profile/NextBadgeChips";
import type { CrawlMode } from "@/components/map/ControlRail";
import type { PintDropsState } from "@/components/map/usePintDrops";
import DrinkMenu from "@/components/drinks/DrinkMenu";
import FoodMenu from "@/components/food/FoodMenu";
import MenuCategoryGrid from "@/components/drinks/MenuCategoryGrid";
import VenueActionStrip from "@/components/map/VenueActionStrip";
import CityPlaceStrip from "@/components/map/CityPlaceStrip";
import VenueBuzz from "@/components/map/VenueBuzz";
import { venueMenuForInspector } from "@/lib/venueMenu";
import { venueFoodMenuForInspector } from "@/lib/venueFoodMenu";
import { menuHubTiles } from "@/lib/menuHub";
import type { DrinkCategory } from "@/lib/drinks";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { lastTrainBadge } from "@/lib/lastTrainBadge";
import type { LastPintDecision } from "@/lib/tfl";
import { proxiedVenueImageUrl } from "@/lib/venueImages";
import { bandsForVenue, STORY_BANDS, type StoryBand } from "@/lib/storyBands";
import { landmarks as londonLandmarks, nearestLandmarks, type Landmark } from "@/lib/landmarks";
import { cuisineTagsForVenue } from "@/lib/cuisineTags";
import { curatedCrawlsForBand, placeStoryMapHref, type CuratedCrawl } from "@/lib/curatedCrawls";
import { getCity, type CityId, DEFAULT_CITY_ID } from "@/lib/cities";
import { lastRideTabLabel } from "@/lib/lastRide";

import "./venueSheet.css";
import "./accessibilityFilters.css";

// Mobile-first tabs regroup the panel's long vertical scroll into thumb-friendly
// sections (most PUBMAXXERs are on a phone while travelling). Drops is the
// primary tab. "getting-home" is a placeholder slot the orchestrator fills with
// a transport card built by another agent — we only render its mount point here.
export type TabKey = "overview" | "pints" | "menu" | "story" | "ask" | "getting-home";

const BASE_TABS: { key: TabKey; label: string; shortLabel: string }[] = [
  { key: "overview", label: "Pub", shortLabel: "Pub" },
  // "Pint" is the narrow-width form — one syllable shorter than "Drops" so the
  // whole strip (5-6 tabs) fits at 390px without clipping.
  { key: "pints", label: "Drops", shortLabel: "Pint" },
  { key: "menu", label: "Menu", shortLabel: "Menu" },
  { key: "story", label: "Lore", shortLabel: "Lore" },
  { key: "ask", label: "Ask", shortLabel: "Ask" },
];

function tabsForCity(cityId: CityId): { key: TabKey; label: string; shortLabel: string }[] {
  const ride = lastRideTabLabel(getCity(cityId).lastRideLabel);
  return [
    ...BASE_TABS,
    { key: "getting-home", label: ride, shortLabel: ride },
  ];
}

const DEFAULT_TAB: TabKey = "pints";

type ShareFeedback = {
  venueId: string;
  tone: "ok" | "error";
  text: string;
};

function isUserCancelledShare(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

const PROVENANCE_LABEL: Record<Provenance, string> = {
  sourced: "Sourced",
  contributor: "Contributor",
  anecdote: "Anecdote",
  demo: "Demo",
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

function Amenity({ active, label }: { active: boolean; label: string }) {
  return <span className={active ? "amenity active" : "amenity"}>{label}</span>;
}

type VenueInspectorProps = {
  venue: Venue;
  mode: CrawlMode;
  inCrawl: boolean;
  latestContributorPrice: number | null | undefined;
  onToggleStop: (id: string) => void;
  onSelectVenue?: (id: string) => void;
  initialTab?: TabKey;
  pintDrops: PintDropsState;
  // The mobile bottom-sheet drag gesture (GH #17) lives in PubMap.tsx (the
  // owner of the .mapDrawer seam); this component only exposes the grab
  // handle as a pointer-event surface so the drag can start from the visible
  // grabber, not just the header bar above it. All three are no-ops on
  // desktop (PubMap gates the gesture to ≤640px before anything fires).
  onGrabDragStart?: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabDragMove?: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabDragEnd?: (event: React.PointerEvent<HTMLElement>) => void;
  onTabSelect?: (key: TabKey) => void;
  /** City landmark catalog for Lore "Around here". Defaults to London. */
  cityLandmarks?: Landmark[];
  /** City Place-story corridors. Defaults to London. */
  cityStoryBands?: StoryBand[];
  /** City curated crawls for Place-story deep links. Defaults to London. */
  cityCuratedCrawls?: CuratedCrawl[];
  /** Active map city — drives Last Pint / Last Tram provider. Defaults to London. */
  cityId?: CityId;
};

export default function VenueInspector({
  venue,
  mode,
  inCrawl,
  latestContributorPrice,
  onToggleStop,
  onSelectVenue,
  initialTab = DEFAULT_TAB,
  pintDrops,
  onGrabDragStart,
  onGrabDragMove,
  onGrabDragEnd,
  onTabSelect,
  cityLandmarks = londonLandmarks,
  cityStoryBands = STORY_BANDS,
  cityCuratedCrawls,
  cityId = DEFAULT_CITY_ID,
}: VenueInspectorProps) {
  const { dropsByVenueId, composerOpen, setComposerOpen, dropMsg, reportDrop } = pintDrops;
  const drops = useMemo(() => dropsByVenueId.get(venue.id) ?? [], [dropsByVenueId, venue.id]);
  const TABS = useMemo(() => tabsForCity(cityId), [cityId]);

  // "I'm here tonight" presence (PRD §1.5 / §5.1 — the tonight loop). Opt-in: it
  // only ever fires from a deliberate tap of this button — NO auto-tracking, NO
  // GPS. Identity is the viewer's self-asserted handle (localStorage
  // `pubmax_handle`, the same one the composer uses); with none set we point them
  // to claim one rather than posting anonymously. Local, per-venue state only —
  // setState fires from the click handler (never an effect), plus the
  // React-recommended "reset on prop change during render" below (no effect).
  const [presenceState, setPresenceState] = useState<"idle" | "sending" | "here" | "no-handle">(
    "idle",
  );
  // The panel isn't remounted when the selected pub changes (PubMap keeps one
  // VenueInspector), so a stale "You're here" would linger on the next venue.
  // React's adjust-state-during-render pattern resets it when the venue id
  // changes — no effect, so react-hooks/set-state-in-effect stays satisfied.
  const [presenceVenueId, setPresenceVenueId] = useState(venue.id);
  if (presenceVenueId !== venue.id) {
    setPresenceVenueId(venue.id);
    setPresenceState("idle");
  }

  // Active tab is local state (Pints is the primary content, so the default).
  // Like presence above, the panel isn't remounted between venues, so a stale
  // tab could linger — React's adjust-state-during-render pattern resets it when
  // the venue id changes (mirrors presenceVenueId). NEVER setState in an effect
  // here (react-hooks/set-state-in-effect is an error in this repo).
  const [tab, setTab] = useState<TabKey>(initialTab);
  const tabKey = `${venue.id}:${initialTab}`;
  const [tabResetKey, setTabResetKey] = useState(tabKey);
  const [shareFeedback, setShareFeedback] = useState<ShareFeedback | null>(null);
  const currentShareFeedback =
    shareFeedback?.venueId === venue.id ? shareFeedback : null;
  if (tabResetKey !== tabKey) {
    setTabResetKey(tabKey);
    setTab(initialTab);
  }

  // The venue's live Last Pint decision, lifted up from LastTrainCard so the
  // Pints tab can stamp each drop with an honest transport-context badge (IDEAS
  // A5). HONESTY CONSTRAINT: this stays null until the user opens the
  // Getting-home tab and LastTrainCard's fetch resolves — the decision simply
  // doesn't exist before then. So if they never open that tab, no badges render.
  // That's correct: a badge without a live decision behind it would be a guess.
  // LastTrainCard still owns the fetch; it only publishes the result via the
  // onDecision callback below. Reset on venue change (same adjust-state-during-
  // render pattern as tab/presence — never an effect) so a stale decision from
  // the previous pub can't leak onto this one's drops.
  const [lastTrainDecision, setLastTrainDecision] = useState<LastPintDecision | null>(null);
  const [decisionVenueId, setDecisionVenueId] = useState(venue.id);
  if (decisionVenueId !== venue.id) {
    setDecisionVenueId(venue.id);
    setLastTrainDecision(null);
  }

  // Refs to the tab buttons so arrow keys can move focus as selection moves
  // (roving tabindex / APG tabs pattern).
  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    overview: null,
    pints: null,
    menu: null,
    story: null,
    ask: null,
    "getting-home": null,
  });

  function selectTab(next: TabKey) {
    setTab(next);
    onTabSelect?.(next);
    tabRefs.current[next]?.focus();
  }

  const shareVenue = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = new URL(venueMapUrl(venue.id), window.location.origin).toString();
    const title = venue.name;
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    const setShareStatus = (tone: ShareFeedback["tone"], text: string) => {
      setShareFeedback({ venueId: venue.id, tone, text });
    };
    const copyToClipboard = async (successText: string, unavailableText: string) => {
      if (!nav?.clipboard?.writeText) {
        setShareStatus("error", unavailableText);
        return;
      }
      try {
        await nav.clipboard.writeText(url);
        setShareStatus("ok", successText);
      } catch {
        setShareStatus("error", "Couldn't copy the link. Copy it from your browser bar.");
      }
    };

    setShareFeedback(null);
    if (typeof nav?.share === "function") {
      try {
        await nav.share({ title, url, text: `PUBMAXXING — ${title}` });
        return;
      } catch (error) {
        if (isUserCancelledShare(error)) return;
        await copyToClipboard(
          "Share failed, but the link was copied.",
          "Share failed and clipboard is unavailable. Copy the page URL.",
        );
        return;
      }
    }
    await copyToClipboard(
      "Link copied.",
      "Sharing and clipboard are unavailable. Copy the page URL.",
    );
  }, [venue.id, venue.name]);

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: TabKey) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const index = TABS.findIndex((t) => t.key === current);
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = (index + delta + TABS.length) % TABS.length;
    selectTab(TABS[nextIndex].key);
  }

  async function markPresenceHere() {
    if (presenceState === "sending" || presenceState === "here") return;
    const handle =
      typeof window === "undefined" ? "" : (window.localStorage.getItem("pubmax_handle") ?? "").trim();
    if (!handle) {
      setPresenceState("no-handle");
      return;
    }
    setPresenceState("sending");
    try {
      const res = await fetch("/api/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, venueId: venue.id }),
      });
      // Presence is best-effort: a non-ok response still lands the viewer back on
      // an actionable state rather than a spinner. A 200 confirms "you're here".
      setPresenceState(res.ok ? "here" : "idle");
    } catch {
      setPresenceState("idle");
    }
  }
  const hasDemoDrops = drops.some((drop) => drop.provenance === "demo");
  // The distinct, provenance-stamped claim list for the inspected venue.
  // Editorial Sourced claims and contributor/anecdote drops stay separate.
  const claims = useMemo(() => buildVenueClaims(venue.curation, drops), [venue.curation, drops]);

  // Known-true accessibility facts only (PRD issue #28). Unknown/known-false
  // facets render nothing — never a "No" — per the provenance-honesty rule.
  const accessChips = accessibilityChipLabels(venue);
  const quietHours = quietHoursLabel(venue);

  // The Menu tab's full drink list (beer from venue.prices + seeded non-beer
  // drinks) — see lib/venueMenu.ts for the composition seam.
  const menuDrinks = useMemo(() => venueMenuForInspector(venue), [venue]);
  const menuFood = useMemo(() => venueFoodMenuForInspector(venue), [venue]);
  const hubTiles = useMemo(() => menuHubTiles(venue, menuDrinks), [venue, menuDrinks]);
  // Menu hub → drinks deep-dive (Greene King–style Menus grid, alcohol-first).
  // Reset when the venue changes so a drill-in never leaks across pubs.
  type MenuView =
    | { mode: "hub" }
    | { mode: "drinks"; category?: DrinkCategory };
  const [menuView, setMenuView] = useState<MenuView>({ mode: "hub" });
  const [menuViewVenueId, setMenuViewVenueId] = useState(venue.id);
  if (menuViewVenueId !== venue.id) {
    setMenuViewVenueId(venue.id);
    setMenuView({ mode: "hub" });
  }
  const venueImageUrl = proxiedVenueImageUrl(venue.imageUrl);

  // Place stories (Wave D): which curated corridors pass through this venue,
  // plus nearby landmark names for the Lore "Around here" section.
  const placeStories = useMemo(
    () => bandsForVenue(venue, cityStoryBands, cityLandmarks),
    [venue, cityStoryBands, cityLandmarks],
  );
  const aroundHere = useMemo(
    () => nearestLandmarks([venue.longitude, venue.latitude], 3, 0.75, cityLandmarks),
    [venue.latitude, venue.longitude, cityLandmarks],
  );
  // Soft cuisine chips (Wave E) — curated id map ∪ searchText keywords.
  const cuisineTags = useMemo(
    () =>
      cuisineTagsForVenue({
        id: venue.id,
        name: venue.name,
        searchText: venue.filterHints?.searchText,
        hintTags: venue.filterHints?.cuisineTags,
      }),
    [venue.id, venue.name, venue.filterHints?.searchText, venue.filterHints?.cuisineTags],
  );

  // Sourced attribution from mergePriceUpdates (optional field on the runtime
  // venue object). Absent when community is fresher or no refresh exists.
  const sourcedPrice = (venue as PricedVenue).sourcedPrice ?? null;
  const sourcedObserved =
    sourcedPrice?.observedAt != null ? formatObservedAt(sourcedPrice.observedAt) : "";

  return (
    <section className="venueInspector">
      {/* The grab handle is the primary drag surface on mobile — a generous
          hit area (not just the thin visual bar) so it's easy to grab with a
          thumb. Pointer handlers are optional props; when absent (e.g. any
          future non-map usage of this component) it's simply not draggable. */}
      <div
        className="venueSheetGrabZone"
        onPointerDown={onGrabDragStart}
        onPointerMove={onGrabDragMove}
        onPointerUp={onGrabDragEnd}
        onPointerCancel={onGrabDragEnd}
      >
        <span className="venueSheetGrab" aria-hidden="true" />
      </div>
      <div className="inspectorTitle">
        <Waves size={17} />
        <span>Venue Detail</span>
      </div>
      <h3>{venue.name}</h3>

      <div className="venueTabs" role="tablist" aria-label="Venue detail sections">
        {TABS.map(({ key, label, shortLabel }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`venueTab-${key}`}
              aria-controls={`venuePanel-${key}`}
              aria-label={label}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={active ? "venueTab active" : "venueTab"}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              onClick={() => selectTab(key)}
              onKeyDown={(event) => onTabKeyDown(event, key)}
            >
              <span className="venueTabFull">{label}</span>
              <span className="venueTabShort" aria-hidden="true">
                {shortLabel}
              </span>
            </button>
          );
        })}
      </div>

      {/* Overview — identity, latest price, add-to-crawl, "I'm here tonight". */}
      <div
        role="tabpanel"
        id="venuePanel-overview"
        aria-labelledby="venueTab-overview"
        className="venueTabPanel"
        hidden={tab !== "overview"}
      >
        {venueImageUrl ? (
          <figure className="venueBaselinePhoto">
            <Image
              src={venueImageUrl}
              alt={`${venue.name} exterior or bar photo`}
              width={720}
              height={420}
              loading="lazy"
              unoptimized
            />
          </figure>
        ) : null}
        <p className="venueAddress">{venue.address}</p>
        <VenueActionStrip venue={venue} />
        <CityPlaceStrip
          venueId={venue.id}
          venueName={venue.name}
          latitude={venue.latitude}
          longitude={venue.longitude}
          primaryBorough={venue.primaryBorough}
          cityId={cityId}
        />
        {/* "What people say" (task A3) — AI-synthesised third-party buzz via
            CityMCP, honestly labelled. Never community/editorial content. */}
        <VenueBuzz
          venueId={venue.id}
          venueName={venue.name}
          latitude={venue.latitude}
          longitude={venue.longitude}
          primaryBorough={venue.primaryBorough}
          cityId={cityId}
        />
        <div className="amenityRow">
          <Amenity active={Boolean(venue.curation.nearWater)} label="water" />
          <Amenity active={venue.hasStory} label="heritage" />
          <Amenity active={Boolean(venue.curation.writerPick)} label="writer" />
          <Amenity active={venue.amenities.beerGarden} label="garden" />
          <Amenity active={venue.amenities.nonAlcoholic} label="0.0" />
          <Amenity active={venue.amenities.liveSports} label="sports" />
          <Amenity active={venue.amenities.food} label="Serves food" />
          <Amenity active={venue.amenities.cocktails} label="cocktails" />
          <Amenity active={venue.amenities.pubQuiz} label="quiz" />
        </div>
        {venue.amenities.food || cuisineTags.length > 0 ? (
          <div className="cuisineRow" aria-label="Food and cuisine">
            {venue.amenities.food ? (
              <p className="cuisineServes">
                <strong>Serves food</strong>
                {cuisineTags.length === 0
                  ? " — plates available; check the board for tonight’s kitchen."
                  : null}
              </p>
            ) : null}
            {cuisineTags.length > 0 ? (
              <div className="cuisineTags">
                {cuisineTags.map((tag) => (
                  <span key={tag} className="cuisineChip">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {/* Accessibility — only publicly-confirmed facts, shown as chips. A pub
            with no confirmed access facts shows nothing here (never a "No"). */}
        {accessChips.length > 0 ? (
          <div className="accessibilityChips" aria-label="Confirmed accessibility">
            {accessChips.map((label) => (
              <span key={label} className="accessibilityChip">
                {label}
              </span>
            ))}
          </div>
        ) : null}
        {quietHours ? (
          <p className="accessibilityQuietHours">
            <strong>Quiet hours:</strong> {quietHours}
          </p>
        ) : null}
        {/* Price honesty on overview: community override wins, then sourced
            observation, then baseline-on-record. Never imply a live feed. */}
        {latestContributorPrice !== null && latestContributorPrice !== undefined ? (
          <div className="contributorPrice">
            <span>
              <ClaimBadge kind="contributor" /> Latest Pint Drop price
            </span>
            <strong>{formatPrice(latestContributorPrice)}</strong>
            {venue.latestContributorAt ? (
              <small>{formatFreshness(venue.latestContributorAt)}</small>
            ) : null}
            <small className="communityPriceNote">{COMMUNITY_PRICE_NOTE}</small>
          </div>
        ) : sourcedPrice ? (
          <div className="contributorPrice">
            <span>
              <ClaimBadge kind="sourced" /> Sourced price
            </span>
            <strong>{formatPrice(venue.cheapestPrice)}</strong>
            {sourcedObserved ? <small>{sourcedObserved}</small> : null}
          </div>
        ) : venue.cheapestPrice !== null && venue.cheapestPrice !== undefined ? (
          <div className="contributorPrice">
            <span>
              <ClaimBadge kind="baseline" /> Baseline on record
            </span>
            <strong>{formatPrice(venue.cheapestPrice)}</strong>
            <small className="communityPriceNote">
              Dataset price — not a live tonight feed.
            </small>
          </div>
        ) : null}
        {mode === "build" ? (
          <button
            className="addStopBtn"
            aria-pressed={inCrawl}
            onClick={() => onToggleStop(venue.id)}
          >
            {inCrawl ? "Remove from crawl" : "Add to crawl"}
          </button>
        ) : null}
        <SaveToListControl venueId={venue.id} venueName={venue.name} />
        <div className="presenceHere">
          {presenceState === "here" ? (
            <p
              className="presenceHereConfirm"
              role="status"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                margin: "12px 0 0",
                minHeight: "42px",
                fontWeight: 700,
                color: "var(--brass)",
              }}
            >
              <MapPin size={15} aria-hidden="true" /> You&rsquo;re here 🍺
            </p>
          ) : (
            <button
              type="button"
              className="addStopBtn"
              onClick={markPresenceHere}
              disabled={presenceState === "sending"}
              aria-label={`Mark that you're at ${venue.name} tonight`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
              }}
            >
              <MapPin size={15} aria-hidden="true" />
              {presenceState === "sending" ? "Checking in…" : "I'm here"}
            </button>
          )}
          {presenceState === "no-handle" ? (
            <p
              className="description muted"
              style={{ marginTop: "8px", fontSize: "0.82rem" }}
            >
              Claim a handle to check in — <Link href="/u/you">set yours</Link>.
            </p>
          ) : null}
        </div>
        {/* Quest chips (IDEAS B2-lite): the viewer's own "next badge" progress,
            resolved from their self-asserted handle (localStorage pubmax_handle)
            inside the component. No handle → renders nothing. */}
        <NextBadgeChips />
      </div>

      {/* Pints — the primary tab: demo note, drops list, composer / log bar. */}
      <div
        role="tabpanel"
        id="venuePanel-pints"
        aria-labelledby="venueTab-pints"
        className="venueTabPanel"
        hidden={tab !== "pints"}
      >
        {composerOpen ? (
          <PintDropComposer
            venueId={venue.id}
            state={pintDrops}
            venueName={venue.name}
            lastTrainDecision={lastTrainDecision}
          />
        ) : (
          <VenuePriceStory venue={venue} drops={drops} />
        )}
        <section className="pintDrops">
          <div className="inspectorTitle">
            <Quote size={16} />
            <span>Pint Drops</span>
          </div>
          {hasDemoDrops ? (
            <div className="demoDataNote">
              <span>Demo data</span>
              Example Pint Drops are seeded for the walkthrough. Live contributions use the same
              flow.
            </div>
          ) : null}
          {composerOpen ? null : (
            <div className="logDropBar">
              <button
                className="logDropBtn"
                onClick={() => {
                  onTabSelect?.("pints");
                  setComposerOpen(true);
                }}
                aria-label={`Log a Pint Drop at ${venue.name}`}
              >
                <PlusCircle size={17} /> Log a Pint Drop
              </button>
              {dropMsg ? (
                <span
                  role={dropMsg.ok ? "status" : "alert"}
                  className={`composerMsg ${dropMsg.ok ? "ok" : "error"}`}
                  style={{ display: "block", marginTop: "8px" }}
                >
                  {dropMsg.text}
                  {dropMsg.ok && dropMsg.links && dropMsg.links.length > 0 ? (
                    <span className="composerMsgLinks">
                      {dropMsg.links.map((link) => (
                        <Link key={link.href} href={link.href} className="composerMsgLink">
                          {link.label}
                        </Link>
                      ))}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
          )}
          {drops.length === 0 ? (
            <p className="description muted">
              No Pint Drops yet at {venue.name}. Be the first — log tonight&rsquo;s price or pass
              down a story using the button below.
            </p>
          ) : (
            <div className="dropList">
              {drops.map((drop) => {
                const hasPhotos = Boolean(drop.pintPhotoUrl || drop.venuePhotoUrl);
                // Honest transport-context stamp (IDEAS A5 / Wave G1): prefer
                // fields captured on the drop at compose time; fall back to the
                // live Getting-home session for older rows that never stored them.
                // See lib/lastTrainBadge.ts — no live kind / leave-by → no badge.
                const trainBadge = lastTrainBadge(
                  drop.createdAt,
                  drop.leaveByIso ?? lastTrainDecision?.leaveByIso,
                  drop.lastTrainDecision ?? lastTrainDecision?.decision,
                );
                return (
                  <article
                    key={drop.id}
                    className={hasPhotos ? "dropCard instaPint" : "dropCard"}
                  >
                    <div className="dropHead">
                      <span className="dropHandle">{drop.handle}</span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                        {drop.priceGbp !== null ? (
                          <span className="dropPrice">{formatPrice(drop.priceGbp)}</span>
                        ) : null}
                        <ProvenanceChip provenance={drop.provenance} />
                      </span>
                    </div>
                    {/* InstaPint: the pint + the cheeky bar selfie shown as a
                        framed image pair (Instagram-ish), the note/tags below as a
                        caption. A single photo fills the frame; a drop with no
                        photo still reads fine as a text card (the block is skipped). */}
                    {hasPhotos ? (
                      <div className="instaFrame">
                        {drop.pintPhotoUrl ? (
                          <figure className="instaShot">
                            <Image
                              className="dropPhoto"
                              src={drop.pintPhotoUrl}
                              alt={`Pint at ${venue.name} shared by ${drop.handle}`}
                              width={480}
                              height={480}
                              loading="lazy"
                              unoptimized
                            />
                            <figcaption>the pint</figcaption>
                          </figure>
                        ) : null}
                        {drop.venuePhotoUrl ? (
                          <figure className="instaShot">
                            <Image
                              className="dropPhoto"
                              src={drop.venuePhotoUrl}
                              alt={`${drop.handle} at the bar at ${venue.name}`}
                              width={480}
                              height={480}
                              loading="lazy"
                              unoptimized
                            />
                            <figcaption>at the bar</figcaption>
                          </figure>
                        ) : null}
                      </div>
                    ) : null}
                    {drop.passedDownNote ? (
                      <p className="dropCaption">{drop.passedDownNote}</p>
                    ) : null}
                    {drop.vibeTags && drop.vibeTags.length > 0 ? (
                      <div className="dropVibeTags">
                        {drop.vibeTags.map((tag) => (
                          <span key={tag} className="vibeChip small">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="dropFoot">
                      <small>
                        {[drop.drink, drop.era].filter(Boolean).join(" · ") || "Visit report"}
                        {trainBadge ? (
                          <span className="trainBadge" data-tone={trainBadge.tone}>
                            {trainBadge.label}
                          </span>
                        ) : null}
                      </small>
                      {drop.provenance !== "demo" ? (
                        <button
                          type="button"
                          className="reportBtn"
                          onClick={() => reportDrop(venue.id, drop.id)}
                          aria-label={`Report Pint Drop by ${drop.handle}`}
                        >
                          <Flag size={12} /> Report
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Menu — visual hub (Drinks first) → drink list deep-dive. Food is
          link-out only when we have a pub website / menu URL. */}
      <div
        role="tabpanel"
        id="venuePanel-menu"
        aria-labelledby="venueTab-menu"
        className="venueTabPanel"
        hidden={tab !== "menu"}
      >
        {menuView.mode === "hub" ? (
          <>
            <VenueActionStrip venue={venue} />
            <MenuCategoryGrid
              tiles={hubTiles}
              venueName={venue.name}
              onOpenDrinks={(category) =>
                setMenuView(
                  category ? { mode: "drinks", category } : { mode: "drinks" },
                )
              }
            />
            <FoodMenu items={menuFood} venueName={venue.name} />
          </>
        ) : (
          <DrinkMenu
            drinks={menuDrinks}
            venueName={venue.name}
            venueId={venue.id}
            categoryFilter={menuView.category}
            onBack={() => setMenuView({ mode: "hub" })}
            backLabel="Menus"
          />
        )}
      </div>

      {/* Story — description / heritage note + provenance-stamped claims. */}
      <div
        role="tabpanel"
        id="venuePanel-story"
        aria-labelledby="venueTab-story"
        className="venueTabPanel"
        hidden={tab !== "story"}
      >
        {venue.description ? (
          <p className="description">{venue.description}</p>
        ) : (
          <p className="description muted">
            No heritage note for {venue.name} yet — log a Pint Drop below with a passed-down story
            to be the first to give this pub some character.
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

        {/* Place stories / Around here (Wave D) — user-facing copy uses
            "Place stories", never internal corridor jargon. */}
        <section className="placeStories" aria-labelledby="place-stories-title">
          <div className="inspectorTitle">
            <BookOpen size={16} />
            <span id="place-stories-title">Place stories</span>
          </div>
          <p className="placeStoriesLead">What should I know about this place?</p>
          {placeStories.length === 0 ? (
            <p className="description muted">
              No Place stories pass through {venue.name} yet — open Place stories
              on the map, or ask the PUBMAXXER.
            </p>
          ) : (
            <div className="placeStoryList">
              {placeStories.map((band) => {
                const source = band.sources[0];
                const storyCrawls = curatedCrawlsForBand(band.id, cityCuratedCrawls);
                const primaryCrawl = storyCrawls[0];
                return (
                  <article key={band.id} className="placeStoryCard">
                    <h4 className="placeStoryTitle">{band.title}</h4>
                    <p className="placeStoryCopy">{band.copy}</p>
                    <div className="placeStoryActions">
                      <Link
                        className="placeStoryWalk"
                        href={placeStoryMapHref(
                          band.id,
                          primaryCrawl?.id,
                          cityId,
                          cityCuratedCrawls,
                        )}
                      >
                        Walk this story
                      </Link>
                      {primaryCrawl ? (
                        <Link
                          className="placeStoryCrawl"
                          href={`/crawls#${encodeURIComponent(primaryCrawl.id)}`}
                        >
                          {primaryCrawl.name}
                        </Link>
                      ) : null}
                      {source ? (
                        <a
                          className="placeStorySource"
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {source.label}
                          <ExternalLink size={13} />
                        </a>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {aroundHere.length > 0 ? (
            <div className="aroundHere">
              <p className="aroundHereLabel">Around here</p>
              <ul className="aroundHereList">
                {aroundHere.map(({ landmark, km }) => (
                  <li key={landmark.id}>
                    <span>{landmark.name}</span>
                    <small>{km < 0.1 ? "<100 m" : `${km.toFixed(1)} km`}</small>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <div className="priceList">
          {venue.prices.slice(0, 6).map((price) => (
            <div key={price.app_price_id}>
              <span>{price.pint_name}</span>
              <strong>{formatPrice(price.price_gbp)}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* Ask — the grounded "Ask the PUBMAXXER" landlord guide. */}
      <div
        role="tabpanel"
        id="venuePanel-ask"
        aria-labelledby="venueTab-ask"
        className="venueTabPanel"
        hidden={tab !== "ask"}
      >
        <LandlordPanel
          venueId={venue.id}
          venueName={venue.name}
          context={{
            era: venue.curation.heritageEra,
            heritageNote: venue.curation.heritageNote,
            address: venue.address,
            borough: venue.primaryBorough,
          }}
        />
      </div>

      {/* Getting home — the nearest station + last trains tonight (TfL), so you
          know when to head off for the last drink. */}
      <div
        role="tabpanel"
        id="venuePanel-getting-home"
        aria-labelledby="venueTab-getting-home"
        className="venueTabPanel"
        hidden={tab !== "getting-home"}
      >
        {tab === "getting-home" ? (
          <LastTrainCard
            key={`${cityId}:${venue.id}:${venue.latitude}:${venue.longitude}:${venue.name}`}
            lat={venue.latitude}
            lng={venue.longitude}
            venueName={venue.name}
            cityId={cityId}
            onSelectVenue={onSelectVenue}
            onDecision={setLastTrainDecision}
          />
        ) : null}
      </div>

      {/* Wave K1 — mobile sticky command bar (Drop / crawl / share / train).
          Desktop keeps actions in-tab; this bar is CSS-hidden above 640px. */}
      <div className="venueSheetStickyBar" role="toolbar" aria-label="Venue actions">
        <button
          type="button"
          className="venueSheetStickyPrimary"
          onClick={() => {
            selectTab("pints");
            setComposerOpen(true);
          }}
          aria-label={`Log a Pint Drop at ${venue.name}`}
        >
          <PlusCircle size={16} aria-hidden="true" />
          Drop
        </button>
        {mode === "build" ? (
          <button
            type="button"
            className="venueSheetStickyGhost"
            aria-pressed={inCrawl}
            onClick={() => onToggleStop(venue.id)}
          >
            <RouteIcon size={15} aria-hidden="true" />
            {inCrawl ? "Remove" : "Crawl"}
          </button>
        ) : null}
        <button
          type="button"
          className="venueSheetStickyGhost"
          onClick={() => {
            void shareVenue();
          }}
          aria-label={`Share ${venue.name}`}
        >
          <Share2 size={15} aria-hidden="true" />
          Share
        </button>
        <button
          type="button"
          className="venueSheetStickyGhost"
          onClick={() => selectTab("getting-home")}
          aria-label="Check last train"
        >
          <TrainFront size={15} aria-hidden="true" />
          Train
        </button>
        {currentShareFeedback ? (
          <span
            role={currentShareFeedback.tone === "error" ? "alert" : "status"}
            className={`venueSheetShareFeedback ${currentShareFeedback.tone}`}
          >
            {currentShareFeedback.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}
