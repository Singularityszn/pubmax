"use client";

// First-class "Tonight" screen — PRIMARY What's-On spine (/api/whats-on),
// same source as the map Tonight lane (W1). CityMCP things-to-do stays a
// secondary Discover overlay; this page must never disagree with the lane.
//
// Kind chips, provenance, and map deep-links mirror the lane. Walk time is a
// straight-line haversine estimate once the viewer shares location (labelled "~").
// React 19 safe: settle() defers setState out of the effect body.

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  ExternalLink,
  Footprints,
  LocateFixed,
  MapPin,
  Route as RouteIcon,
  TrainFront,
  Tv,
  X,
} from "lucide-react";

import NowSegment from "@/components/nav/NowSegment";
import SiteNav from "@/components/nav/SiteNav";
import { Button } from "@/components/ui/button";
import Screen from "@/components/ui/screen";
import { useWhatsOnTonight, type TonightFreshnessKind } from "@/components/map/useWhatsOnTonight";
import { useOutListings } from "@/components/out/useOutListings";
import EditorialRail from "@/components/out/EditorialRail";
import DealsTonightLane from "@/components/discovery/DealsTonightLane";
import MusicTonightLane from "@/components/discovery/MusicTonightLane";
import TonightChainDeals from "./TonightChainDeals";
import TonightCheapPints from "./TonightCheapPints";
import TonightConditionsStrip from "./TonightConditionsStrip";
import TonightHypedPubs from "./TonightHypedPubs";
import TonightListingsNotice from "./TonightListingsNotice";
import TonightProvenanceLines from "./TonightProvenanceLines";
import TonightGetHomeStrip from "./TonightGetHomeStrip";
import TonightOnTonightSummary from "./TonightOnTonightSummary";
import AreaNewsRail from "@/components/desktop/AreaNewsRail";
import { nearestNightAreaForViewport } from "@/lib/nightAreas";
import TonightShareButton from "./TonightShareButton";
import TonightSoftPlansModule from "./TonightSoftPlansModule";
import { useFirstListingsRead } from "./useFirstListingsRead";
import TodayQuietPintCard from "@/app/today/TodayQuietPintCard";
import { trackEvent } from "@/lib/analytics";
import {
  LOCATION_FINDING_LABEL,
  LOCATION_FINDING_STATUS,
  LOCATION_REMOVE_LABEL,
  LOCATION_RETRY_LABEL,
  LOCATION_SHARE_LABEL,
  LOCATION_UNAVAILABLE_STATUS,
  locationDisclosureLines,
} from "@/lib/locationDisclosure";
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
import {
  TonightRowAccept,
  type TonightRowEvidence,
} from "@/app/tonight/TonightRowAccept";
import { VENUE_ACCEPTANCE_STORAGE_ERROR } from "@/lib/venueAcceptance";
import {
  readRememberedArea,
  rememberedPatchId,
  type RememberedArea,
} from "@/lib/nightPatches";
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

const LOCATION_SURFACE = "tonight-walk-and-last-train" as const;
import {
  tonightAcceptedVenueId,
  tonightLedeComposition,
  tonightListingLede,
  tonightListingLanes,
  tonightEmptyLead,
  tonightHeldRowCount,
  tonightListingsNoteLine,
  tonightNoteOffersRetry,
  tonightPaintStatus,
  tonightPicksState,
  tonightRetryLanes,
  tonightRowLinks,
  tonightProvenanceCredits,
  tonightWhatsOnObservedAt,
} from "@/lib/tonightOutListings";
import type { HypedPub } from "@/lib/hypedPubs";
import type { TonightCheapPint } from "@/lib/tonightCheapPints";
import { withoutTonightChainRows } from "@/lib/tonightChainLanes";
import type { PicksContext } from "@/lib/picksState";
import { parsePlanOccasionIdFromSearch } from "@/lib/planOccasion";
import type { QuietPintModule } from "@/lib/quietPint";
import { whatsOnBarePriceGbp, type WhatsOnKind, type WhatsOnRow } from "@/lib/whatsOn";
import {
  checkedLabel,
  laneKindFacets,
  laneTimeLabel,
  WHATS_ON_KIND_META,
} from "@/lib/whatsOnBadges";

import "./tonight.css";
import "./tonightDedup.css";
import "./tonightLede.css";
import "./tonightOnTonightSummary.css";

type Origin = { lat: number; lng: number };
type LocationStatus = "idle" | "requesting" | "unavailable";

// Honest source-freshness label (L13 contract): an unknown source is stated as
// such, never the request instant dressed as a check. An undatable source drops
// out of the interpunct chain and gets its own sentence below it (VOICE.md rule
// 2), because a chain segment reading like an enum is what made this line look
// like debug output. Keying off the kind makes the intent explicit.
//
// `observedAt` is `tonightWhatsOnObservedAt`, the live read's own per-kind
// answer, and NEVER `asOf`: that field is the freshest of the bundled
// artifacts and the rows, so a quiet night took its date off a snapshot file
// and told a phone the night was checked two weeks ago (captain 6 Sep 2026).
function freshnessLabel(kind: TonightFreshnessKind, observedAt: string | null): string | null {
  return kind === "unknown" ? null : checkedLabel(observedAt);
}

// The coarse Night Area the news rail reads, derived from the area the viewer
// already told us. Never stored, and never a new location ask.
function areaNewsSlug(
  tonightNear: ReturnType<typeof resolveTonightNear>,
): string | null {
  if (!tonightNear) return null;
  const area = nearestNightAreaForViewport("london", [
    tonightNear.near.lng,
    tonightNear.near.lat,
  ]);
  return area?.slug ?? null;
}

// Presentation order is independent of grouping: Deals/Music full lanes follow
// the main list on phones. Desktop keeps a compact rail summary instead
// (UI_UX_FIX_PRD #1), so the main column remains the only full listing spine.
function mobileSecondaryLanes(lanes: ReactNode): ReactNode {
  return (
    <div className="tonightSecondaryLanes tonightSecondaryLanes--mobile">{lanes}</div>
  );
}

// A thin night (0-2 confirmed listings) leaves the list short enough that the
// page dies into empty gradient below it. Rather than invent listings (never,
// "thin nights stay thin" is honest), the rest of the page answers what
// somebody standing here still wants: which pubs are cheap, how they get home,
// and what else is worth planning around.
const THIN_NIGHT_MAX_ROWS = 2;

type QuietAlternative = {
  href: Route;
  icon: typeof TrainFront;
  title: string;
  sub: string;
};

// The cheapest-pints row this list used to open with is gone: the quiet page
// now carries those pubs themselves, with their own figures, above the vibe
// chips. A link to a list beside the list is one door too many.
const QUIET_ALTERNATIVES: QuietAlternative[] = [
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
  quietPint = null,
  softPlansWindow = false,
  mapSelectableVenueIds,
  hypedPubs,
  cheapPints,
}: {
  /** Server-composed quiet-pint module; null outside a quiet window. */
  quietPint?: QuietPintModule | null;
  /** Typical-pattern hour reads quiet — surfaces soft plan handoffs. */
  softPlansWindow?: boolean;
  /** Eager-shard venue ids the map can open via `?sel=`, or null when unreadable. */
  mapSelectableVenueIds?: readonly string[] | null;
  /** The pubs people are talking about, read at build from the committed pack. */
  hypedPubs?: readonly HypedPub[];
  /** Cheapest listed pints, for the nights nothing is on. */
  cheapPints?: readonly TonightCheapPint[];
}) {
  const [activeKind, setActiveKind] = useState<WhatsOnKind | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  // The area the viewer last chose anywhere in the app (#427 nightPatches
  // seam, written by the map's Near me). Read in an effect: localStorage is
  // browser-only and the first paint must match SSR.
  const [remembered, setRemembered] = useState<RememberedArea | null>(null);
  // The occasion the reader arrived with, so a door out of an empty section
  // still plans the night they came here for. Read off the address in the same
  // deferred pass as the remembered area rather than through useSearchParams,
  // which would put this page behind a Suspense boundary for one optional
  // parameter. Only the closed ids answer, so nothing arbitrary is forwarded.
  const [occasion, setOccasion] = useState<string | null>(null);
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
      if (cancelled) return;
      setRemembered(readRememberedArea());
      setOccasion(parsePlanOccasionIdFromSearch(window.location.search));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Real position wins; else the remembered patch's heart; else store order —
  // the same answer the map's Near me gives, so tabs stop disagreeing.
  const router = useRouter();
  const tonightNear = resolveTonightNear(origin, remembered);
  const { rows, sourceFreshnessKind, kindObservedAt, status, retry } = useWhatsOnTonight(
    true,
    tonightNear?.near ?? null,
    { pubOnly: true },
  );
  const {
    body: outBody,
    failed: outFailed,
    pending: outPending,
    retry: retryOut,
  } = useOutListings("tonight");
  const selectableVenueIds = useMemo(
    () => {
      if (mapSelectableVenueIds === undefined) return undefined;
      if (mapSelectableVenueIds === null) return null;
      return new Set(mapSelectableVenueIds);
    },
    [mapSelectableVenueIds],
  );
  const outAnswer = useMemo(
    () => ({ body: outBody, failed: outFailed, pending: outPending }),
    [outBody, outFailed, outPending],
  );
  // One instant answers both questions. Reading the clock twice lets the merge
  // drop the night's last row while the status still calls the page ready, and
  // a ready page over no rows shows neither cards nor the quiet-night sentence.
  // A retry puts the spine back to `idle`, which empties the merge of BOTH
  // lanes, so the paint reads the answer already on screen and only the state
  // below says a read is running. Counted across both lanes on purpose: the
  // retry control is offered when the SPINE reported, and a spine that reported
  // holds no rows, so the list under that button is the Out lane's.
  const paintStatus = tonightPaintStatus(status, tonightHeldRowCount(rows, outAnswer));
  const { listingRows, primaryListingRows, listingsStatus, outEvents } = useMemo(() => {
    // The past guard needs the real clock, and this memo reads it again only
    // when one of the two reads answers, so both halves keep the same instant.
    // eslint-disable-next-line react-hooks/purity -- deliberate clock read
    const now = Date.now();
    return tonightLedeComposition(rows, outAnswer, paintStatus, now, selectableVenueIds);
  }, [rows, paintStatus, outAnswer, selectableVenueIds]);
  const retryLanes = tonightRetryLanes(status, outAnswer);
  const retryWhatsOnLane = retryLanes.whatsOn;
  const retryOutLane = retryLanes.out;
  const retryListings = useCallback(() => {
    if (retryWhatsOnLane) retry();
    if (retryOutLane) retryOut();
  }, [retryWhatsOnLane, retryOutLane, retry, retryOut]);

  // Explicit acceptance (§4.8): only "Keep this venue" reaches here. Opening a
  // listing stays browse-only. Writes one PlanningIntent (source "tonight")
  // carrying the remembered area and the honest source-freshness date, then hands
  // the Venue off via the accept deep link. Storage failure stays on Tonight,
  // reports the error, and emits nothing.
  const acceptVenue = useCallback(
    (venueId: string, familyKey: string, evidence: TonightRowEvidence) => {
      const result = acceptTonightVenue({
        venueId,
        area: remembered,
        // Tonight answers "tonight"; like Near, no explicit future date is chosen.
        startsAt: null,
        observedAt: evidence.observedAt,
        evidenceKind: evidence.kind,
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
    [remembered, router],
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
  // Consume the canonical model: the server already ordered, diversity-capped
  // and flattened the rows, so regrouping with the same rule reconstructs the
  // server's cards in the server's order (the client stops being its own
  // grouping authority).
  // The coarse point every deal surface on this page measures from: the centre
  // of the viewer's nearest area, never their own fix. Same coarse read the
  // area news rail below already takes.
  const dealAnchor = useMemo(
    () => dealProximityAnchor(tonightNear?.near ?? null),
    [tonightNear],
  );
  const groupedAll = useMemo(() => {
    const groups = groupTonightListings(primaryListingRows, tonightNear?.near ?? null);
    // Deals order among themselves: nearest patch first, then closing soonest.
    // In place, so no quiz, match or gig moves to make room, and so the order
    // holds on the mixed list rather than only behind the Deal filter.
    return orderDealsInPlace(groups, (group) => group.row, dealAnchor);
  }, [primaryListingRows, tonightNear, dealAnchor]);
  const groupedSecondaryAll = useMemo(() => {
    const groups = groupTonightListings(listingRows, tonightNear?.near ?? null);
    return orderDealsInPlace(groups, (group) => group.row, dealAnchor);
  }, [listingRows, tonightNear, dealAnchor]);
  const grouped = useMemo(
    () => (activeKind ? groupedAll.filter((g) => g.row.kind === activeKind) : groupedAll),
    [groupedAll, activeKind],
  );
  const facets = useMemo(() => laneKindFacets(groupedAll.map((g) => g.row)), [groupedAll]);
  const displayedFacets = useMemo(() => laneKindFacets(grouped.map((g) => g.row)), [grouped]);
  const ready = listingsStatus === "ready";
  const firstListingsRead = useFirstListingsRead(listingsStatus);
  const listingLede = useMemo(
    () =>
      firstListingsRead ? (
        <span className="tonightLedeHold" aria-hidden="true" />
      ) : (
        tonightListingLede(listingsStatus, primaryListingRows, selectableVenueIds)
      ),
    [firstListingsRead, primaryListingRows, listingsStatus, selectableVenueIds],
  );
  const visibleVibeChips = useMemo(
    () => visibleTonightVibeChips(ready ? facets.map((facet) => facet.kind) : []),
    [facets, ready],
  );

  const empty = listingsStatus === "empty";
  // What a fallback door must not drop. The patch id is already validated by
  // readRememberedArea; a remembered BOROUGH carries no patch, so it is left
  // off rather than guessed at.
  const picksContext = useMemo<PicksContext>(
    () => ({
      patchId: rememberedPatchId(remembered),
      occasion,
    }),
    [remembered, occasion],
  );
  // Null when the source cannot be dated; the header then prints the plain
  // sentence instead of a dated chain segment.
  // The day the What's-On rows on screen were observed, off the live read's own
  // per-kind map. Undated when a kind cannot be dated and undated on a night
  // carrying no What's-On rows, because a snapshot on disk is not a check.
  const whatsOnObservedAt = useMemo(
    () =>
      tonightWhatsOnObservedAt({
        renderedGroups: grouped,
        outEvents,
        kindObservedAt,
      }),
    [grouped, outEvents, kindObservedAt],
  );
  const checked = freshnessLabel(sourceFreshnessKind, whatsOnObservedAt);
  // The ordering claim rides the What's-On credit, so it is only made when
  // there are rows in that order and a patch to name.
  const nearestPatchSuffix =
    ready && tonightNear?.patchLabel
      ? ` · nearest ${tonightNear.patchLabel} first`
      : null;
  // Each lane is credited and dated by its OWN read. The What's-On stamp above
  // says nothing about a Ticketmaster row, so it never covers one.
  const provenance = useMemo(
    () =>
      tonightProvenanceCredits({
        renderedGroups: grouped,
        outEvents,
        whatsOnChecked: checked,
        outObservedAt: outBody?.observedAt,
      }),
    [grouped, outEvents, outBody, checked],
  );
  // A lane that could not answer is named beside the cards, not only in place
  // of them: a degraded Out answer still carrying Ticketmaster rows makes the
  // list short for a reason the reader is owed.
  const listingsNote = tonightListingsNoteLine(status, outAnswer, selectableVenueIds);
  const noteOffersRetry = tonightNoteOffersRetry(status, outAnswer, selectableVenueIds);
  // ONE state for the whole section (lib/picksState.ts). `idle` is a read in
  // flight; anything else that could not answer is unreadable. The note is the
  // reason, and `checkedAt` is the day the rows on screen were OBSERVED, off
  // the live read's own per-kind map, so a held answer is dated by its own
  // evidence rather than by the instant we re-asked or by a bundled file.
  const listingsState = useMemo(
    () =>
      tonightPicksState({
        visibleCount: primaryListingRows.length,
        whatsOn: status,
        out: outAnswer,
        listingsStatus,
        note: listingsNote,
        retryLanes,
        checkedAt: whatsOnObservedAt,
      }),
    [
      primaryListingRows.length,
      status,
      outAnswer,
      listingsStatus,
      listingsNote,
      retryLanes,
      whatsOnObservedAt,
    ],
  );
  // Which read a row came from decides how keeping it is recorded, so the Out
  // lane is identified by the same reference identity the credits use.
  const rowEvidence = useMemo(() => {
    const fromOut = new Set(
      tonightListingLanes(primaryListingRows, outEvents).outRows,
    );
    return (row: WhatsOnRow): TonightRowEvidence => ({
      observedAt: row.observedAt,
      kind: fromOut.has(row) ? "out-listing" : "whats-on",
    });
  }, [primaryListingRows, outEvents]);
  // Unfiltered primary listing count, not the kind-filtered `visible.length` - a thin
  // night stays thin regardless of which chip is active, and this must not
  // flicker in/out as the user taps filters.
  const thinNight = empty || (ready && primaryListingRows.length <= THIN_NIGHT_MAX_ROWS);
  const hasGeoRows =
    ready &&
    primaryListingRows.some(
      (row) => typeof row.lat === "number" && typeof row.lng === "number",
    );
  const showLocation = hasGeoRows || thinNight;
  const locationExpanded = locationOpen || origin != null;

  // Secondary Deals/Music lanes reuse already-loaded all-row grouped heroes
  // instead of each firing their own /api/whats-on fetch.
  const localityBasis = tonightLocalityBasis(origin != null, tonightNear);
  // A chain row has its own labelled block now, so it leaves the generic Deals
  // lane: one Wetherspoon offer under two headings is the same offer counted
  // twice, and the unlabelled heading is the one that reads as the city's.
  const secondaryHeroes = withoutTonightChainRows(
    groupedSecondaryAll.map((group) => group.row),
  );
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
  const summaryRows = grouped.map((group) => group.row);

  return (
    <main
      id="main"
      className="tonightPage"
      data-testid="tonight-screen"
      data-listings-status={listingsStatus}
      data-picks-state={listingsState.kind}
    >
      <SiteNav active="tonight" />
      <NowSegment current="tonight" />

      {/* The head is the Screen primitive (docs/design/LAUNCH_SCREENS.md), and
          the Screen is the desktop grid: its head takes the first cell, the
          listing spine follows it down the primary column, and the context rail
          sits beside them. The map is the one primary, because that is where
          tonight's listings become a pint; Find my pint is the quieter way
          onward.

          THE LISTINGS ARE THE ANSWER, SO NOTHING THAT ACTS ON THEM STANDS IN
          FRONT OF THEM. This page put the head, its two doors, the freshness
          credits, the share control and nine vibe chips above the first row: at
          390x844 the row began at y=868 against a tab bar at y=788, and at
          320x568 at y=972 against y=514, so a phone met no listing at all. The
          way-onward row now ends the screen (`actionsAfterContent`), and the
          credits and the vibe chips follow the list. Only the head's words and
          the list's own kind filter come first, which puts the first row at
          y=413 at all three phone widths. Every move is a DOM move, so the
          reading order, the tab order and the paint order stay one order.
          Measured in docs/proof/tonight-first-row-fold/. */}
      <Screen
        as="div"
        className="tonightDesktopGrid"
        kicker="Tonight in London"
        title={tonightHeading(localityBasis)}
        titleId="tonight-title"
        primary={
          <Link prefetch={false} href="/map" className="tonightFootLink">
            See them on the map
          </Link>
        }
        secondary={
          <Link prefetch={false} href="/near?locate=1">
            Find my pint
          </Link>
        }
        actionsAfterContent
      >
      <div className="tonightPrimary" data-status={listingsStatus}>
      {/* The lede membership follows the Tonight rule in
          docs/rules/app-proxy-csp-caching-and-file-tracing.md. Chain blocks
          and cheap pints stay outside it so they cannot lead the answer. */}
      <div className="tonightLedeRegion" data-testid="tonight-lede">
      <TonightHypedPubs rows={hypedPubs} selectableVenueIds={selectableVenueIds} />
      {listingLede ? <p className="screenLede">{listingLede}</p> : null}
      <TonightListingsNotice
        state={listingsState}
        note={listingsNote}
        noteOffersRetry={noteOffersRetry}
        emptyLead={tonightEmptyLead(status, outAnswer)}
        heldRowCount={primaryListingRows.length}
        context={picksContext}
        onRetry={retryListings}
      />

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
                {activeKind === null ? (
                  <span className="tonightChipCount">{groupedAll.length}</span>
                ) : null}
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
                  {activeKind === null || activeKind === facet.kind ? (
                    <span className="tonightChipCount">
                      {activeKind === null ? facet.count : grouped.length}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          <ul id="tonight-list" className="tonightList" data-testid="tonight-list">
            {grouped.map((group) => {
              const row = group.row;
              const { primary: link, mapHref, sourceLabel } = tonightRowLinks(
                row,
                selectableVenueIds,
              );
              const venueId = tonightAcceptedVenueId(row, selectableVenueIds);
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
                    <span className="tonightRowSource">via {sourceLabel}</span>
                  </div>
                  {dealListingAge ? (
                    <p className="tonightRowListingAge">{dealListingAge}</p>
                  ) : null}
                  {link ? (
                    <span className="tonightRowCta">
                      {link.external ? (
                        <>
                          {sourceLabel}
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
                      <Link prefetch={false}
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
                  {mapHref ? (
                    <Link prefetch={false}
                      className="tonightRowMapLink pressable"
                      href={mapHref}
                      onClick={() => trackEvent("tonight_result_opened", { kind: row.kind, localityBasis })}
                    >
                      Open on map
                      <ArrowRight size={13} aria-hidden="true" />
                    </Link>
                  ) : null}
                  {/* Explicit acceptance stays distinct from the browse tap. */}
                  {venueId ? (
                    <TonightRowAccept
                      venueId={venueId}
                      familyKey={tonightAcceptanceFamilyKey(row)}
                      evidence={rowEvidence(row)}
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
                          const altLink = tonightRowLinks(alt, selectableVenueIds).primary;
                          const altVenueId = tonightAcceptedVenueId(alt, selectableVenueIds);
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
                                  <Link prefetch={false} className="tonightRowMoreLink pressable" href={altLink.href}>
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
                              {altVenueId ? (
                                <TonightRowAccept
                                  venueId={altVenueId}
                                  familyKey={tonightAcceptanceFamilyKey(alt)}
                                  evidence={rowEvidence(alt)}
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
        </>
      ) : null}

      </div>
      </div>

      {/* The first pub and its map action precede the listing explanation and
          weather at every width. Both details remain available below it. */}
      <div className="tonightWeather">
        <TonightConditionsStrip origin={origin} tonightMode />
      </div>

      {/* The freshness stamp and the share control sit UNDER the listings they
          are about. A stamp is a footnote on the data, and nobody shares a list
          they have not read yet. */}
      <div className="tonightHeadCredits">
        {ready || empty ? (
          <TonightProvenanceLines
            provenance={provenance}
            nearestSuffix={nearestPatchSuffix}
          />
        ) : null}
        <TonightShareButton />
      </div>

      {/* THE RAIL (site audit D8) is ONE element AFTER the lede in the DOM. A
          phone reads its blocks under the lede in the order it always had: vibe
          chips, the full Deals and Music lanes, the editorial rail, the soft
          plans and the area news. From 1100px the same element is the column
          beside the lede, in the same order and with no gap. `.tonightPrimary`
          above holds the lede and nothing else, so no chain row can stand
          inside it. From 1100px the full lanes hide and the rail summary stands
          in for them. */}
      <aside className="tonightContext" aria-label="Tonight at a glance">
        {ready ? (
          <TonightOnTonightSummary
            facets={displayedFacets}
            rows={summaryRows}
            totalCount={grouped.length}
          />
        ) : null}

      {/* Real pubs before a mood ask. A night with nothing listed still has
          pubs in it, and a listed price is the one thing this product can put
          in front of somebody standing on a pavement. */}
      <TonightCheapPints rows={cheapPints} show={thinNight} />

      {/* The chains keep their supply and lose the front row: each block
          carries the chain's own name and the day its page was read. */}
      <TonightChainDeals rows={listingRows} selectableVenueIds={selectableVenueIds} />

      {/* Vibe chips follow the list. Nine chips wrapped to four rows above it,
          and five of them lead off the page, so they were nine ways not to read
          tonight's listings. They are a mood ask for a reader the list did not
          suit, never the list's own filter, which stays above it. */}
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

      {mobileLanes}

        <div className="tonightEditorial">
          <EditorialRail />
        </div>

        {softPlansWindow ? (
          <TonightSoftPlansModule hasQuietPint={Boolean(quietPint)} />
        ) : null}

        {/* Area news needs a coarse area: the shared location's nearest Night
            Area (never stored), else the heart of the viewer's remembered patch.
            This is the area they told us, so there is no new location ask. */}
        <div className="tonightRail">
          <AreaNewsRail area={areaNewsSlug(tonightNear)} />
        </div>
      </aside>

      <div className="tonightAfterPrimary">

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
                  <Link prefetch={false} href={alt.href} className="tonightQuietLink pressable">
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
          <Button
            type="button"
            variant="ghost"
            className="tonightLocationToggle uiButton--start"
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
          </Button>
          {locationExpanded ? (
            <div className="tonightLocationBody">
              {/* The disclosure is lib/locationDisclosure's, not this file's:
                  one owner for the words, so the prompt, /privacy and Today's
                  own ask cannot drift apart (Astra F01). */}
              <p className="tonightLocationCopy">Sharing location is optional.</p>
              {locationDisclosureLines(LOCATION_SURFACE).map((line) => (
                <p className="tonightLocationCopy" key={line}>
                  {line}
                </p>
              ))}
              {origin ? (
                <button
                  type="button"
                  className="tonightLocationButton"
                  onClick={clearLocation}
                >
                  <X size={15} aria-hidden="true" />
                  {LOCATION_REMOVE_LABEL}
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
                    ? LOCATION_FINDING_LABEL
                    : locationStatus === "unavailable"
                      ? LOCATION_RETRY_LABEL
                      : LOCATION_SHARE_LABEL[LOCATION_SURFACE]}
                </button>
              )}
              <span className="tonightSrOnly" role="status" aria-live="polite">
                {locationStatus === "requesting"
                  ? LOCATION_FINDING_STATUS
                  : locationStatus === "unavailable"
                    ? LOCATION_UNAVAILABLE_STATUS
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
      </Screen>
    </main>
  );
}
