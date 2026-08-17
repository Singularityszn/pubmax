"use client";

// First-class "Tonight" screen — PRIMARY What's-On spine (/api/whats-on),
// same source as the map Tonight lane (W1). CityMCP things-to-do stays a
// secondary Discover overlay; this page must never disagree with the lane.
//
// Kind chips, provenance, and map deep-links mirror the lane. Walk time is a
// straight-line haversine estimate once the viewer shares location (labelled "~").
// React 19 safe: settle() defers setState out of the effect body.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Beer,
  CalendarClock,
  ChevronDown,
  ExternalLink,
  Footprints,
  LocateFixed,
  MapPin,
  RefreshCw,
  Route as RouteIcon,
  TrainFront,
  Tv,
  X,
} from "lucide-react";

import NowSegment from "@/components/nav/NowSegment";
import SiteNav from "@/components/nav/SiteNav";
import { useWhatsOnTonight, type TonightFreshnessKind } from "@/components/map/useWhatsOnTonight";
import ListingsSkeleton from "@/components/out/ListingsSkeleton";
import { useOutListings } from "@/components/out/useOutListings";
import DealsTonightLane from "@/components/discovery/DealsTonightLane";
import MusicTonightLane from "@/components/discovery/MusicTonightLane";
import TonightConditionsStrip from "./TonightConditionsStrip";
import TonightGetHomeStrip from "./TonightGetHomeStrip";
import TonightOnTonightSummary from "./TonightOnTonightSummary";
import AreaNewsRail from "@/components/desktop/AreaNewsRail";
import { nearestNightAreaForViewport } from "@/lib/nightAreas";
import TonightShareButton from "./TonightShareButton";
import TonightSoftPlansModule from "./TonightSoftPlansModule";
import TodayQuietPintCard from "@/app/today/TodayQuietPintCard";
import { trackEvent } from "@/lib/analytics";
import { firstHttp } from "@/lib/httpUrl";
import {
  resolveTonightNear,
  tonightHeading,
  tonightLocalityBasis,
  walkLabel,
  walkMinutes,
} from "@/lib/tonight";
import {
  acceptTonightVenue,
  tonightAcceptanceFamilyKey,
  type TonightAcceptanceError,
} from "@/lib/tonightAcceptance";
import { TonightRowAccept } from "@/app/tonight/TonightRowAccept";
import { VENUE_ACCEPTANCE_STORAGE_ERROR } from "@/lib/venueAcceptance";
import { readRememberedArea, type RememberedArea } from "@/lib/nightPatches";
import { VibeChipButton, VibeChipLink, VibeChips } from "@/components/vibe/VibeChips";
import { planOccasionHref, TONIGHT_SOFT_PLAN_CHIPS } from "@/lib/planOccasion";
import { palChatHref, visibleTonightVibeChips } from "@/lib/vibeChips";
import { dealDigestNote } from "@/lib/dealsDigest";
import {
  dealEndsCaption,
  dealListingAgeCaption,
  dealProximityAnchor,
  orderDealsInPlace,
} from "@/lib/dealsHonesty";
import { groupTonightListings } from "@/lib/tonightListGrouping";
import {
  mergeTonightListingRows,
  tonightListingsErrorLine,
  tonightListingsStatus,
} from "@/lib/tonightOutListings";
import type { QuietPintModule } from "@/lib/quietPint";
import type { TrustedHandoffFlagsDTO } from "@/lib/trustedHandoffFlags";
import { whatsOnBarePriceGbp, type WhatsOnKind, type WhatsOnRow } from "@/lib/whatsOn";
import {
  checkedLabel,
  laneKindFacets,
  laneTimeLabel,
  WHATS_ON_KIND_META,
} from "@/lib/whatsOnBadges";

import "./tonight.css";
import "./tonightDedup.css";
import "./tonightOnTonightSummary.css";

type Origin = { lat: number; lng: number };
type LocationStatus = "idle" | "requesting" | "unavailable";

function rowHref(row: WhatsOnRow): { href: string; external: boolean } | null {
  if (typeof row.venueId === "string" && row.venueId.length > 0) {
    return { href: `/map?sel=${encodeURIComponent(row.venueId)}`, external: false };
  }
  const url = firstHttp(row.source?.url);
  if (url) return { href: url, external: true };
  return null;
}

function coverageLabel(count: number): string {
  if (count === 0) return "Quiet night";
  if (count === 1) return "1 listing tonight";
  return `${count} listings tonight`;
}

// Honest source-freshness label (L13 contract): an unknown source is stated as
// such, never the request instant dressed as a check. An undatable source drops
// out of the interpunct chain and gets its own sentence below it (VOICE.md rule
// 2), because a chain segment reading like an enum is what made this line look
// like debug output. Keying off the kind makes the intent explicit.
function freshnessLabel(kind: TonightFreshnessKind, asOf: string | null): string | null {
  return kind === "unknown" ? null : checkedLabel(asOf);
}

const UNDATED_SOURCE_LINE = "We can’t date these listings yet.";

// Presentation order is independent of grouping: Deals/Music full lanes follow
// the main list on phones. Desktop keeps a compact rail summary instead
// (UI_UX_FIX_PRD #1), so the main column remains the only full listing spine.
function mobileSecondaryLanes(lanes: ReactNode): ReactNode {
  return (
    <div className="tonightSecondaryLanes tonightSecondaryLanes--mobile">{lanes}</div>
  );
}

// A thin night (0-2 confirmed listings) leaves the list short enough that the
// page dies into empty gradient below it. Rather than invent listings (never
// — "thin nights stay thin" is honest), fill the rest of the page with the
// three things someone standing here actually still wants: where's cheap,
// how do I get home, and what else is there to do tonight.
const THIN_NIGHT_MAX_ROWS = 2;

type QuietAlternative = {
  href: string;
  icon: typeof Beer;
  title: string;
  sub: string;
};

const QUIET_ALTERNATIVES: QuietAlternative[] = [
  {
    href: "/map",
    icon: Beer,
    title: "Cheapest pints in London",
    sub: "Listed pint prices on the map",
  },
  {
    href: "/map",
    icon: TrainFront,
    title: "Check your last train home",
    sub: "Open a pub's Getting Home tab on the map",
  },
  {
    href: "/crawls",
    icon: RouteIcon,
    title: "Browse crawls",
    sub: "Multi-stop routes worth planning around",
  },
];

export default function TonightClient({
  flags,
  quietPint = null,
  softPlansWindow = false,
}: {
  flags: TrustedHandoffFlagsDTO;
  /** Server-composed quiet-pint module; null outside a quiet window. */
  quietPint?: QuietPintModule | null;
  /** Typical-pattern hour reads quiet — surfaces soft plan handoffs. */
  softPlansWindow?: boolean;
}) {
  const [activeKind, setActiveKind] = useState<WhatsOnKind | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  // The area the viewer last chose anywhere in the app (#427 nightPatches
  // seam, written by the map's Near me). Read in an effect: localStorage is
  // browser-only and the first paint must match SSR.
  const [remembered, setRemembered] = useState<RememberedArea | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("idle");
  const [acceptanceError, setAcceptanceError] = useState<TonightAcceptanceError | null>(null);
  // The location card is a quiet, collapsed row until tapped — it must not be
  // the first thing on the page. Once a position is shared it stays open so the
  // last-train strip has somewhere to live.
  const [locationOpen, setLocationOpen] = useState(false);

  useEffect(() => {
    trackEvent("tonight_screen_view");
    let cancelled = false;
    // Deferred like useWhatsOnTonight's setState (react-hooks rule): the
    // remembered area lands next microtask, before the first fetch settles.
    void Promise.resolve().then(() => {
      if (!cancelled) setRemembered(readRememberedArea());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Real position wins; else the remembered patch's heart; else store order —
  // the same answer the map's Near me gives, so tabs stop disagreeing.
  const router = useRouter();
  const tonightNear = resolveTonightNear(origin, remembered);
  const { rows, asOf, sourceObservedAt, sourceFreshnessKind, kindObservedAt, status, retry } = useWhatsOnTonight(
    true,
    tonightNear?.near ?? null,
  );
  const {
    body: outBody,
    failed: outFailed,
    pending: outPending,
    retry: retryOut,
  } = useOutListings("tonight");
  const outAnswer = useMemo(
    () => ({ body: outBody, failed: outFailed, pending: outPending }),
    [outBody, outFailed, outPending],
  );
  const listingRows = useMemo(
    () => mergeTonightListingRows(rows, outBody?.events ?? []),
    [rows, outBody],
  );
  const listingsStatus = tonightListingsStatus(status, outAnswer);
  const retryListings = useCallback(() => {
    retry();
    retryOut();
  }, [retry, retryOut]);

  // Explicit acceptance (§4.8): only "Keep this venue" reaches here. Opening a
  // listing stays browse-only. Writes one PlanningIntent (source "tonight")
  // carrying the remembered area and the honest source-freshness date, then hands
  // the Venue off via the accept deep link. Storage failure stays on Tonight,
  // reports the error, and emits nothing.
  const acceptVenue = useCallback(
    (venueId: string, familyKey: string) => {
      const result = acceptTonightVenue({
        venueId,
        area: remembered,
        // Tonight answers "tonight"; like Near, no explicit future date is chosen.
        startsAt: null,
        observedAt: sourceObservedAt,
        fallbackCityId: "london",
      });
      if (!result.accepted || !result.telemetry) {
        setAcceptanceError({ venueId, familyKey, message: VENUE_ACCEPTANCE_STORAGE_ERROR });
        return;
      }
      setAcceptanceError(null);
      trackEvent("venue_accepted", result.telemetry);
      router.push(result.href);
    },
    [remembered, sourceObservedAt, router],
  );

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("unavailable");
      return;
    }
    setLocationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setOrigin({ lat: latitude, lng: longitude });
        setLocationStatus("idle");
      },
      () => setLocationStatus("unavailable"),
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 8_000 },
    );
  }, []);

  const clearLocation = useCallback(() => {
    setOrigin(null);
    setLocationStatus("idle");
  }, []);

  // Collapse chain-wide duplicate offers (decision #11): one card per offer
  // family, nearest venue first, the rest behind a "Same deal at N pubs"
  // expander. Grouped on the same near signal that orders the list, so the card
  // and its ordering agree. Group the whole set once, then filter by kind — a
  // family carries a single kind, so this equals grouping the kind-filtered rows.
  // Consume the canonical model: when PUBMAX_TONIGHT_GROUPING is on the server
  // already ordered + diversity-capped + flattened the rows, so regrouping with
  // the SAME v2 mode reconstructs the server's cards in the server's order (the
  // client stops being its own grouping authority). Flag off keeps the shipped
  // chain-duplicate collapse, byte-identical to today.
  // The coarse point every deal surface on this page measures from: the centre
  // of the viewer's nearest area, never their own fix. Same coarse read the
  // area news rail below already takes.
  const dealAnchor = useMemo(
    () => dealProximityAnchor(tonightNear?.near ?? null),
    [tonightNear],
  );
  const groupedAll = useMemo(() => {
    const groups = groupTonightListings(listingRows, tonightNear?.near ?? null, {
      v2: flags.tonightGrouping,
    });
    // Deals order among themselves: nearest patch first, then closing soonest.
    // In place, so no quiz, match or gig moves to make room, and so the order
    // holds on the mixed list rather than only behind the Deal filter.
    return orderDealsInPlace(groups, (group) => group.row, dealAnchor);
  }, [listingRows, tonightNear, flags.tonightGrouping, dealAnchor]);
  const grouped = useMemo(
    () => (activeKind ? groupedAll.filter((g) => g.row.kind === activeKind) : groupedAll),
    [groupedAll, activeKind],
  );
  // Filter chips count what the viewer actually sees — grouped families — while
  // the provenance line below stays the raw inventory total ("16 listings
  // tonight"). Reusing laneKindFacets on the grouped display rows keeps the map
  // lane's own facets (same shared helper) untouched.
  const facets = useMemo(() => laneKindFacets(groupedAll.map((g) => g.row)), [groupedAll]);
  const ready = listingsStatus === "ready";
  const visibleVibeChips = useMemo(
    () => visibleTonightVibeChips(ready ? facets.map((facet) => facet.kind) : []),
    [facets, ready],
  );

  const empty = listingsStatus === "empty";
  // Null when the source cannot be dated; the header then prints the plain
  // sentence instead of a dated chain segment.
  const checked = freshnessLabel(sourceFreshnessKind, asOf);
  const errored = listingsStatus === "error";
  const loading = listingsStatus === "idle";
  // Unfiltered listing count, not the kind-filtered `visible.length` — a thin
  // night stays thin regardless of which chip is active, and this must not
  // flicker in/out as the user taps filters.
  const thinNight = empty || (ready && listingRows.length <= THIN_NIGHT_MAX_ROWS);
  const hasGeoRows =
    ready &&
    listingRows.some(
      (row) => typeof row.lat === "number" && typeof row.lng === "number",
    );
  const showLocation = hasGeoRows || thinNight;
  const locationExpanded = locationOpen || origin != null;

  // Secondary Deals/Music lanes reuse the already-loaded grouped heroes instead
  // of each firing their own /api/whats-on fetch.
  const localityBasis = tonightLocalityBasis(origin != null, tonightNear);
  const secondaryHeroes = groupedAll.map((group) => group.row);
  const secondaryLanes = (
    <>
      <DealsTonightLane rows={secondaryHeroes} anchor={dealAnchor} />
      {/* The music lane is dated by the MUSIC feed, never by the freshest thing
          on the page: the deals feed is rebuilt far more often, and borrowing
          its date would claim gigs were confirmed on a day nobody looked. */}
      <MusicTonightLane rows={secondaryHeroes} asOf={kindObservedAt.music} />
    </>
  );
  const mobileLanes = mobileSecondaryLanes(secondaryLanes);
  const summaryRows = groupedAll.map((group) => group.row);

  return (
    <main
      id="main"
      className="tonightPage"
      data-testid="tonight-screen"
      data-listings-status={listingsStatus}
    >
      <SiteNav active="tonight" />

      <div className="tonightDesktopGrid">
      <header className="tonightHead">
        <NowSegment current="tonight" />
        <div className="tonightEyebrowRow">
          <p className="tonightEyebrow">Tonight in London</p>
          <TonightShareButton />
        </div>
        <h1 className="tonightTitle">{tonightHeading(localityBasis)}</h1>
        <p className="tonightLede">
          Quiz, sport, deals, and live music from sourced listings. Open a listed
          venue on the map.
        </p>
        {ready || empty ? (
          <>
            {/* Both lines are named, so a browser test can ask which line it is
                looking at instead of matching the sentence inside it. This
                header's wording has been rewritten twice and took the specs
                that read it down both times. */}
            <p className="tonightProvenance" data-tonight-provenance="coverage" data-tonight-dated={checked ? "yes" : "no"}>
              {coverageLabel(listingRows.length)}
              <span aria-hidden="true"> · </span>
              {/* One template literal so the separator spacing survives JSX
                  text-node splitting (the built output was eating the space before
                  the interpunct, rendering "unknown· via"). */}
              {`${checked ? `${checked} · ` : ""}via what’s-on`}
              {/* The one quiet continuity line: when the order comes from a
                  remembered patch (not a live position), say which. */}
              {ready && tonightNear?.patchLabel
                ? ` · nearest ${tonightNear.patchLabel} first`
                : null}
            </p>
            {checked ? null : (
              <p className="tonightProvenance" data-tonight-provenance="undated">{UNDATED_SOURCE_LINE}</p>
            )}
          </>
        ) : null}
      </header>

      <aside className="tonightContext" aria-label="Tonight at a glance">
        <TonightConditionsStrip origin={origin} />
        {ready ? (
          <TonightOnTonightSummary
            facets={facets}
            rows={summaryRows}
            totalCount={groupedAll.length}
          />
        ) : null}
        {/* Area news needs a coarse area: the shared location's nearest Night
            Area (never stored), else the heart of the viewer's remembered patch.
            This is the area they told us, so there is no new location ask. */}
        <div className="tonightRail">
          <AreaNewsRail
            area={
              tonightNear
                ? (nearestNightAreaForViewport("london", [
                    tonightNear.near.lng,
                    tonightNear.near.lat,
                  ])?.slug ?? null)
                : null
            }
          />
        </div>
      </aside>

      <div className="tonightPrimary" data-status={listingsStatus}>
      {loading ? <ListingsSkeleton /> : null}

      {errored ? (
        <div className="tonightStatus tonightStatusError">
          <p role="status">{tonightListingsErrorLine(status, outAnswer)}</p>
          <button type="button" className="tonightRetry" onClick={retryListings}>
            <RefreshCw size={15} aria-hidden="true" />
            Retry listings
          </button>
        </div>
      ) : null}

      {empty ? (
        <p className="tonightStatus" role="status">
          The city&apos;s having a quiet one tonight. We only list what&apos;s
          really on, and nothing&apos;s confirmed yet.{" "}
          <Link href="/map" className="tonightStatusLink">
            The map still knows where the cheap pints are
          </Link>
          .
        </p>
      ) : null}

      {ready || empty ? (
        /* Vibe picker (docs/VIBE_LAYER_SPEC_2026-07-19.md): the user's voice,
           not the brand's. Kind-backed chips appear only when their listing
           kind exists; ask-backed chips remain useful on an empty night. */
        <VibeChips
          shellClassName="tonightVibes"
          groupLabel="What’s the vibe tonight"
          lede={"What’s the vibe?"}
        >
          {visibleVibeChips.map((chip) =>
            chip.tonight.type === "filter" ? (
              <VibeChipButton
                key={chip.id}
                active={ready && activeKind === chip.tonight.kind}
                onClick={() => {
                  const kind =
                    chip.tonight.type === "filter" ? chip.tonight.kind : null;
                  setActiveKind((current) =>
                    current === kind ? null : kind,
                  );
                  trackEvent("tonight_vibe_select", { vibe: chip.id });
                }}
              >
                {chip.label}
              </VibeChipButton>
            ) : (
              <VibeChipLink
                key={chip.id}
                href={
                  chip.id === "quiet"
                    ? planOccasionHref("quiet", { src: "tonight-vibes" })
                    : palChatHref(chip)
                }
                onClick={() =>
                  trackEvent("tonight_vibe_select", { vibe: chip.id })
                }
              >
                {chip.label}
              </VibeChipLink>
            ),
          )}
          {TONIGHT_SOFT_PLAN_CHIPS.map((chip) => (
            <VibeChipLink
              key={chip.id}
              href={planOccasionHref(chip.id, { src: "tonight-vibes" })}
              onClick={() =>
                trackEvent("tonight_vibe_select", { vibe: chip.id })
              }
            >
              {chip.label}
            </VibeChipLink>
          ))}
        </VibeChips>
      ) : null}

      {ready ? (
        <>
          {facets.length > 1 ? (
            <div
              className="tonightFilters"
              role="group"
              aria-label="Filter tonight by kind"
            >
              <button
                type="button"
                className="tonightChip"
                data-active={activeKind === null}
                aria-pressed={activeKind === null}
                onClick={() => setActiveKind(null)}
              >
                All
                <span className="tonightChipCount">{groupedAll.length}</span>
              </button>
              {facets.map((facet) => (
                <button
                  key={facet.kind}
                  type="button"
                  className="tonightChip"
                  data-active={activeKind === facet.kind}
                  data-kind={facet.kind}
                  aria-pressed={activeKind === facet.kind}
                  onClick={() => {
                    setActiveKind(facet.kind);
                    trackEvent("tonight_filter_select", { kind: facet.kind });
                  }}
                >
                  {facet.label}
                  <span className="tonightChipCount">{facet.count}</span>
                </button>
              ))}
            </div>
          ) : null}

          <ul id="tonight-list" className="tonightList" data-testid="tonight-list">
            {grouped.map((group) => {
              const row = group.row;
              const link = rowHref(row);
              const meta = WHATS_ON_KIND_META[row.kind];
              const when = laneTimeLabel(row) ?? meta.badgeLabel;
              const walk =
                typeof row.lat === "number" && typeof row.lng === "number"
                  ? walkLabel(walkMinutes(origin, { lat: row.lat, lng: row.lng }))
                  : null;
              const KindIcon = row.kind === "sport" ? Tv : CalendarClock;
              const barePrice = whatsOnBarePriceGbp(row);
              // A deal carries an exact window and a listing date, so it says
              // when it closes and how old the listing is. Both read off the row.
              const dealEnds = row.kind === "deal" ? dealEndsCaption(row) : null;
              const dealListingAge =
                row.kind === "deal" ? dealListingAgeCaption(row) : null;
              const RowInner = (
                <>
                  <div className="tonightRowMeta">
                    <span className="tonightRowKind" data-kind={row.kind}>
                      <KindIcon size={12} aria-hidden="true" />
                      {meta.label}
                    </span>
                    {barePrice !== null ? (
                      <span className="tonightRowPrice">
                        £{barePrice.toFixed(2)}
                      </span>
                    ) : null}
                  </div>
                  <h2 className="tonightRowTitle">{row.title}</h2>
                  <p className="tonightRowPlace">
                    <MapPin size={13} aria-hidden="true" />
                    <span>{row.placeName}</span>
                  </p>
                  <div className="tonightRowFacts">
                    {when ? <span className="tonightRowWhen">{when}</span> : null}
                    {dealEnds ? (
                      <span className="tonightRowEnds">{dealEnds}</span>
                    ) : null}
                    {walk ? (
                      <span className="tonightRowWalk">
                        <Footprints size={12} aria-hidden="true" />
                        {walk}
                      </span>
                    ) : null}
                    <span className="tonightRowSource">via {row.source.label}</span>
                  </div>
                  {dealListingAge ? (
                    <p className="tonightRowListingAge">{dealListingAge}</p>
                  ) : null}
                  {link ? (
                    <span className="tonightRowCta">
                      {link.external ? (
                        <>
                          {row.source.label}
                          <ExternalLink size={13} aria-hidden="true" />
                        </>
                      ) : (
                        <>
                          Open on map
                          <ArrowRight size={13} aria-hidden="true" />
                        </>
                      )}
                    </span>
                  ) : null}
                </>
              );
              return (
                <li
                  key={row.id}
                  className="tonightRow"
                  data-kind={row.kind}
                  data-testid="tonight-row"
                >
                  {link ? (
                    link.external ? (
                      <a
                        className="tonightRowLink pressable"
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        onClick={() => trackEvent("tonight_result_opened", { kind: row.kind, localityBasis })}
                      >
                        {RowInner}
                      </a>
                    ) : (
                      <Link
                        className="tonightRowLink pressable"
                        href={link.href}
                        onClick={() => trackEvent("tonight_result_opened", { kind: row.kind, localityBasis })}
                      >
                        {RowInner}
                      </Link>
                    )
                  ) : (
                    <div className="tonightRowLink">{RowInner}</div>
                  )}
                  {/* Explicit acceptance stays distinct from the browse tap. */}
                  {typeof row.venueId === "string" && row.venueId.length > 0 ? (
                    <TonightRowAccept
                      venueId={row.venueId}
                      familyKey={tonightAcceptanceFamilyKey(row)}
                      placeName={row.placeName}
                      className="tonightRowAccept"
                      label="Keep this venue"
                      acceptanceError={acceptanceError}
                      onAccept={acceptVenue}
                    />
                  ) : null}
                  {group.venueCount > 1 ? (
                    <details className="tonightRowMore">
                      <summary className="tonightRowMoreToggle">
                        <ChevronDown
                          size={14}
                          aria-hidden="true"
                          className="tonightRowMoreChevron"
                        />
                        {dealDigestNote(group.venueCount)}
                      </summary>
                      <ul className="tonightRowMoreList">
                        {group.alternates.map((alt) => {
                          const altLink = rowHref(alt);
                          const altWalk =
                            typeof alt.lat === "number" && typeof alt.lng === "number"
                              ? walkLabel(walkMinutes(origin, { lat: alt.lat, lng: alt.lng }))
                              : null;
                          const altPlace = (
                            <span className="tonightRowMorePlace">
                              <MapPin size={12} aria-hidden="true" />
                              {alt.placeName}
                            </span>
                          );
                          return (
                            <li key={alt.id} className="tonightRowMoreItem">
                              {altLink ? (
                                altLink.external ? (
                                  <a
                                    className="tonightRowMoreLink pressable"
                                    href={altLink.href}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                  >
                                    {altPlace}
                                    {altWalk ? (
                                      <span className="tonightRowMoreWalk">{altWalk}</span>
                                    ) : null}
                                  </a>
                                ) : (
                                  <Link className="tonightRowMoreLink pressable" href={altLink.href}>
                                    {altPlace}
                                    {altWalk ? (
                                      <span className="tonightRowMoreWalk">{altWalk}</span>
                                    ) : null}
                                  </Link>
                                )
                              ) : (
                                <span className="tonightRowMoreLink">
                                  {altPlace}
                                  {altWalk ? (
                                    <span className="tonightRowMoreWalk">{altWalk}</span>
                                  ) : null}
                                </span>
                              )}
                              {typeof alt.venueId === "string" && alt.venueId.length > 0 ? (
                                <TonightRowAccept
                                  venueId={alt.venueId}
                                  familyKey={tonightAcceptanceFamilyKey(alt)}
                                  placeName={alt.placeName}
                                  className="tonightRowMoreAccept"
                                  label="Keep"
                                  acceptanceError={acceptanceError}
                                  onAccept={acceptVenue}
                                />
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {grouped.length === 0 ? (
            <p className="tonightStatus" role="status">
              No {activeKind ? WHATS_ON_KIND_META[activeKind].label.toLowerCase() : "matching"}{" "}
              listings tonight.{" "}
              <button
                type="button"
                className="tonightInlineReset"
                onClick={() => setActiveKind(null)}
              >
                Show all
              </button>
            </p>
          ) : null}

          <p className="tonightFoot">
            <Link href="/map" className="tonightFootLink">
              See them on the map
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </p>
        </>
      ) : null}

      </div>

      {mobileLanes}

      <div className="tonightAfterPrimary">
      {softPlansWindow ? (
        <TonightSoftPlansModule hasQuietPint={Boolean(quietPint)} />
      ) : null}

      {/* Heritage quiet-pint module: same TodayQuietPintCard as /today. Lives
          after the listing spine so main-list-first stays intact, and only when
          the server quiet window allows (null renders nothing). Not the thin-
          night CTA strip below: that invents no pubs; this surfaces cited ones. */}
      {quietPint ? (
        <div className="tonightQuietPint" id="tonight-quiet-pint">
          <TodayQuietPintCard module={quietPint} />
        </div>
      ) : null}

      {thinNight ? (
        <section className="tonightQuiet" aria-label="While it's quiet">
          <p className="tonightQuietLede">
            Quiet one tonight. Still worth a look:
          </p>
          <ul className="tonightQuietList">
            {QUIET_ALTERNATIVES.map((alt) => {
              const Icon = alt.icon;
              return (
                <li key={alt.title} className="tonightQuietRow">
                  <Link href={alt.href} className="tonightQuietLink pressable">
                    <span className="tonightQuietIcon" aria-hidden="true">
                      <Icon size={17} />
                    </span>
                    <span className="tonightQuietBody">
                      <span className="tonightQuietTitle">{alt.title}</span>
                      <span className="tonightQuietSub">{alt.sub}</span>
                    </span>
                    <ArrowRight size={15} aria-hidden="true" className="tonightQuietArrow" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {showLocation ? (
        <section
          className="tonightLocation"
          aria-label="Location for walk times and last train"
        >
          <button
            type="button"
            className="tonightLocationToggle pressable"
            aria-expanded={locationExpanded}
            onClick={() => setLocationOpen((open) => !open)}
          >
            <LocateFixed size={15} aria-hidden="true" />
            <span className="tonightLocationToggleLabel">
              Walk times and last train
            </span>
            <ChevronDown
              size={16}
              aria-hidden="true"
              className="tonightLocationChevron"
              data-open={locationExpanded}
            />
          </button>
          {locationExpanded ? (
            <div className="tonightLocationBody">
              <p className="tonightLocationCopy">
                Sharing location is optional. Walk times stay on this page; your
                rough position (nearest 100m or so) is used once to check your
                nearest station and last train, and is never saved.
              </p>
              {origin ? (
                <button
                  type="button"
                  className="tonightLocationButton"
                  onClick={clearLocation}
                >
                  <X size={15} aria-hidden="true" />
                  Remove location
                </button>
              ) : (
                <button
                  type="button"
                  className="tonightLocationButton"
                  onClick={requestLocation}
                  disabled={locationStatus === "requesting"}
                >
                  <LocateFixed size={15} aria-hidden="true" />
                  {locationStatus === "requesting"
                    ? "Finding your location…"
                    : locationStatus === "unavailable"
                      ? "Try location again"
                      : "Share location for walk times and last train"}
                </button>
              )}
              <span className="tonightSrOnly" role="status" aria-live="polite">
                {locationStatus === "requesting"
                  ? "Finding your location."
                  : locationStatus === "unavailable"
                    ? "Location unavailable. You can try again."
                    : origin
                      ? "Walk times are now shown."
                      : ""}
              </span>
              {origin ? <TonightGetHomeStrip origin={origin} /> : null}
            </div>
          ) : null}
        </section>
      ) : null}
      </div>
      </div>
    </main>
  );
}
