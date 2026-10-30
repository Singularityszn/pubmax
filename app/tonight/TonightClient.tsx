"use client";

import { ReadyButton } from "@/components/ui/ready-button";

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
  Tv,
  X,
} from "lucide-react";

import NowSegment from "@/components/nav/NowSegment";
import SiteNav from "@/components/nav/SiteNav";
import PriceBadge from "@/components/PriceBadge";
import { Button } from "@/components/ui/button";
import { RowList, RowListItem } from "@/components/ui/row-list";
import Screen from "@/components/ui/screen";
import PreparedBriefStamp from "@/components/seo/PreparedBriefStamp";
import { useWhatsOnTonight, type TonightFreshnessKind, type WhatsOnTonight } from "@/components/map/useWhatsOnTonight";
import { useOutListings } from "@/components/out/useOutListings";
import EditorialRail from "@/components/out/EditorialRail";
import DealsTonightLane from "@/components/discovery/DealsTonightLane";
import MusicTonightLane from "@/components/discovery/MusicTonightLane";
import NewSinceMarker from "@/components/seen/NewSinceMarker";
import { useNewSinceLastLook } from "@/lib/seenSinceLastLook";
import TonightChainDeals from "./TonightChainDeals";
import TonightCheapPints from "./TonightCheapPints";
import TonightConditionsStrip from "./TonightConditionsStrip";
import TonightHypedPubs from "./TonightHypedPubs";
import TonightListingsNotice from "./TonightListingsNotice";
import TonightProvenanceLines from "./TonightProvenanceLines";
import TonightGetHomeStrip from "./TonightGetHomeStrip";
import TonightLastOrdersDoor from "./TonightLastOrdersDoor";
import TonightLaterListings from "./TonightLaterListings";
import TonightOpenPlans from "./TonightOpenPlans";
import TonightOnTonightSummary from "./TonightOnTonightSummary";
import TonightYourPubs from "./TonightYourPubs";
import AreaNewsRail from "@/components/desktop/AreaNewsRail";
import PlacePhoto from "@/components/listing/PlacePhoto";
import type { PlacePhoto as PlacePhotoData } from "@/components/listing/placePhotoRules";
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
  tonightMusicLaneObservedAt,
  tonightNoteOffersRetry,
  tonightPaintStatus,
  tonightPicksState,
  tonightRetryLanes,
  tonightRowLinks,
  tonightProvenanceCredits,
  tonightWhatsOnObservedAt,
} from "@/lib/tonightOutListings";
import type { LoadWhatsOnResult } from "@/lib/whatsOnStore";
import type { TonightOutAnswer } from "@/lib/tonightOutListings";
import type { HypedPub } from "@/lib/hypedPubs";
import type { TonightCheapPint } from "@/lib/tonightCheapPints";
import { withoutTonightChainRows } from "@/lib/tonightChainLanes";
import type { PicksContext } from "@/lib/picksState";
import { parsePlanOccasionIdFromSearch } from "@/lib/planOccasion";
import type { QuietPintModule } from "@/lib/quietPint";
import { EMPTY_KIND_OBSERVED_AT, musicLaneRows, whatsOnBarePriceGbp, type WhatsOnKind, type WhatsOnRow } from "@/lib/whatsOn";
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
//
// A read with no observed day is undated too. `checkedLabel(null)` answers the
// sentence "No date on this yet", and set inside the chain it printed "No
// events listed · No date on this yet · via what's-on" on a phone (taste
// plan, 18 Oct 2026); null hands it to the one undated sentence instead.
function freshnessLabel(kind: TonightFreshnessKind, observedAt: string | null): string | null {
  if (kind === "unknown" || !observedAt) return null;
  return checkedLabel(observedAt);
}

// The sourced pub suggestions are counted once: the credit row and the empty
// lead must agree on whether Tonight has anything to show beside events.
function hypedPubCount(rows: readonly HypedPub[] | undefined): number {
  return rows?.length ?? 0;
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

function TonightUnmatchedNotice({ out }: { out: TonightOutAnswer }): ReactNode {
  if (!out.body?.events.some((row) => !row.venueId)) return null;
  return <p className="tonightProvenance">Some event listings are not matched to a pub.</p>;
}

// The rail leads with a photograph of the place the page is about: the Night
// Area the reader told us (the same coarse area the news rail reads), else
// London when the heading is London's. Never a pub's photograph: those go
// only to the recommended pub they are of.
function tonightPagePhotos(
  photos: TonightPhotos | undefined,
  area: string | null,
): { lead: PlacePhotoData | null; pubs: TonightPhotos["pubPhotos"] | undefined } {
  if (!photos) return { lead: null, pubs: undefined };
  const lead = (area ? photos.areaPhotos[area] : undefined) ?? photos.londonPhoto;
  return { lead, pubs: photos.pubPhotos };
}

function TonightRailPhoto({ photo }: { photo: PlacePhotoData | null }) {
  if (!photo) return null;
  return <PlacePhoto className="tonightRailPhoto" photo={photo} sizes="360px" />;
}

// A thin night (0-2 confirmed listings) leaves the list short enough that the
// page dies into empty gradient below it. Rather than invent listings (never,
// "thin nights stay thin" is honest), the rest of the page answers what
// somebody standing here still wants: which pubs are cheap, how they get home,
// and what else is worth planning around.
const THIN_NIGHT_MAX_ROWS = 2;

function isThinNight(empty: boolean, ready: boolean, listingCount: number): boolean {
  return empty || (ready && listingCount <= THIN_NIGHT_MAX_ROWS);
}

type QuietAlternative = {
  href: Route;
  title: string;
  sub: string;
};

// The cheapest-pints row this list used to open with is gone: the quiet page
// now carries those pubs themselves, with their own figures, above the vibe
// chips. A link to a list beside the list is one door too many.
const QUIET_ALTERNATIVES: QuietAlternative[] = [
  {
    href: "/map",
    title: "Check your last train home",
    sub: "Open a pub's Getting Home tab on the map",
  },
  {
    href: "/crawls",
    title: "Browse crawls",
    sub: "Multi-stop routes worth planning around",
  },
];

const EMPTY_SERVER_ROWS: WhatsOnRow[] = [];

function initialWhatsOnView(answer: LoadWhatsOnResult | null): Pick<
  WhatsOnTonight, "rows" | "status" | "sourceFreshnessKind" | "kindObservedAt"
> {
  const rows = answer?.rows ?? EMPTY_SERVER_ROWS;
  return {
    rows,
    status: answer?.readStatus === "ready" ? rows.length > 0 ? "ready" : "empty" : "error",
    sourceFreshnessKind: answer?.sourceFreshnessKind ?? "unknown",
    kindObservedAt: answer?.kindObservedAt ?? EMPTY_KIND_OBSERVED_AT,
  };
}

/** The photographs the server resolved for this page (app/tonight/page.tsx). */
export type TonightPhotos = {
  /** A recommended pub's own photograph, by venue id. */
  pubPhotos: Readonly<Record<string, PlacePhotoData>>;
  /** Each Night Area's photograph, by area slug. */
  areaPhotos: Readonly<Record<string, PlacePhotoData>>;
  /** London's, for the page when no area is known. */
  londonPhoto: PlacePhotoData | null;
};

type InitialListings = {
  whatsOn: LoadWhatsOnResult | null;
  out: TonightOutAnswer;
  renderedAt: number;
};

function useInitialListings(
  seed: InitialListings | undefined,
  liveWhatsOn: WhatsOnTonight,
  liveOut: ReturnType<typeof useOutListings>,
) {
  const [initial, setInitial] = useState(seed ?? null);
  // Both browser reads replace the public server answer, including failures.
  useEffect(() => {
    if (liveWhatsOn.status === "idle" || liveOut.pending) return;
    void Promise.resolve().then(() => setInitial(null));
  }, [liveWhatsOn.status, liveOut.pending]);
  const clearInitial = useCallback(() => setInitial(null), []);
  return {
    whatsOn: initial ? initialWhatsOnView(initial.whatsOn) : liveWhatsOn,
    out: initial?.out ?? liveOut,
    renderedAt: initial?.renderedAt,
    // A new server response updates the page date. Browser reads do not.
    pagePreparedAt: seed?.renderedAt,
    clearInitial,
  };
}

export default function TonightClient({
  quietPint = null,
  softPlansWindow = false,
  mapSelectableVenueIds,
  hypedPubs,
  cheapPints,
  initialListings,
  photos,
}: {
  initialListings?: InitialListings;
  /** Server-composed quiet-pint module; null outside a quiet window. */
  quietPint?: QuietPintModule | null;
  /** Typical-pattern hour reads quiet — surfaces soft plan handoffs. */
  softPlansWindow?: boolean;
  /** Eager-shard venue ids the map can open via `?sel=`, or null when unreadable. */
  mapSelectableVenueIds?: readonly string[] | null;
  /** Pubs Londoners keep recommending, read at build from the committed pack. */
  hypedPubs?: readonly HypedPub[];
  /** Cheapest listed pints, for the nights nothing is on. */
  cheapPints?: readonly TonightCheapPint[];
  /** Honest photographs only: a pub's own, an area's, London's. */
  photos?: TonightPhotos;
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
  const liveWhatsOn = useWhatsOnTonight(
    true,
    tonightNear?.near ?? null,
    { pubOnly: true },
  );
  const liveOut = useOutListings("tonight");
  const initialAnswer = useInitialListings(initialListings, liveWhatsOn, liveOut);
  const { rows, status, sourceFreshnessKind, kindObservedAt } = initialAnswer.whatsOn;
  const { renderedAt, pagePreparedAt, clearInitial } = initialAnswer;
  const { retry } = liveWhatsOn;
  const { retry: retryOut } = liveOut;
  const {
    body: outBody, failed: outFailed, pending: outPending, sourceEvidence: outSourceEvidence,
  }: TonightOutAnswer = initialAnswer.out;
  const selectableVenueIds = useMemo(
    () => {
      if (mapSelectableVenueIds === undefined) return undefined;
      if (mapSelectableVenueIds === null) return null;
      return new Set(mapSelectableVenueIds);
    },
    [mapSelectableVenueIds],
  );
  const outAnswer = useMemo(
    () => ({ body: outBody, failed: outFailed, pending: outPending, sourceEvidence: outSourceEvidence }),
    [outBody, outFailed, outPending, outSourceEvidence],
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
    const now = renderedAt ?? Date.now();
    return tonightLedeComposition(rows, outAnswer, paintStatus, now, selectableVenueIds);
  }, [rows, paintStatus, outAnswer, selectableVenueIds, renderedAt]);
  const retryLanes = tonightRetryLanes(status, outAnswer);
  const retryWhatsOnLane = retryLanes.whatsOn;
  const retryOutLane = retryLanes.out;
  const retryListings = useCallback(() => {
    clearInitial();
    if (retryWhatsOnLane) retry();
    if (retryOutLane) retryOut();
  }, [retryWhatsOnLane, retryOutLane, retry, retryOut, clearInitial]);

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
  const secondaryHeroes = useMemo(
    () => withoutTonightChainRows(groupedSecondaryAll.map((group) => group.row)),
    [groupedSecondaryAll],
  );
  const secondaryMusic = useMemo(() => musicLaneRows(secondaryHeroes), [secondaryHeroes]);
  const creditedGroups = useMemo(() => {
    const music = new Set(secondaryMusic);
    const primary = new Set(grouped.map((group) => group.row));
    return [...grouped, ...groupedSecondaryAll.filter(
      (group) => music.has(group.row) && !primary.has(group.row),
    )];
  }, [grouped, groupedSecondaryAll, secondaryMusic]);
  const facets = useMemo(() => laneKindFacets(groupedAll.map((g) => g.row)), [groupedAll]);
  const displayedFacets = useMemo(() => laneKindFacets(grouped.map((g) => g.row)), [grouped]);
  const ready = listingsStatus === "ready";
  // Which listing cards this device has not been shown before. A card is a
  // family (one offer at many pubs), so it is judged by every member's id
  // (lib/seenSinceLastLook.ts); the list is remembered once it has painted.
  const groupedIds = useMemo(
    () => grouped.map((group) => [group.row.id, ...group.alternates.map((alt) => alt.id)]),
    [grouped],
  );
  const newSinceLastLook = useNewSinceLastLook("tonight", groupedIds, ready);
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
  // per-kind map. A missing kind date leaves the credit undated. An empty
  // surface may use the live read's date, as tonightWhatsOnObservedAt defines.
  const whatsOnObservedAt = useMemo(
    () =>
      tonightWhatsOnObservedAt({
        renderedGroups: creditedGroups,
        outEvents: outBody?.events ?? [],
        kindObservedAt,
        now: renderedAt,
      }),
    [creditedGroups, outBody, kindObservedAt, renderedAt],
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
  const pubSuggestionCount = hypedPubCount(hypedPubs);
  const provenance = useMemo(
    () =>
      tonightProvenanceCredits({
        renderedGroups: creditedGroups,
        out: outAnswer,
        whatsOnRows: rows,
        whatsOnChecked: checked,
        now: renderedAt,
        pubSuggestionCount,
      }),
    [creditedGroups, outAnswer, rows, checked, pubSuggestionCount, renderedAt],
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
  const thinNight = isThinNight(empty, ready, primaryListingRows.length);
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
  // The music lane mixes What's-On and Out cards, so one stamp has to cover
  // both reads, each dated by its own evidence (lib/tonightOutListings.ts).
  const musicLaneObservedAt = useMemo(
    () =>
      tonightMusicLaneObservedAt({
        rows: withoutTonightChainRows(groupedSecondaryAll.map((group) => group.row)),
        outEvents: outBody?.events ?? [],
        kindObservedAt,
        outObservedAt: outBody?.observedAt,
      }),
    [groupedSecondaryAll, outBody, kindObservedAt],
  );
  const secondaryLanes = (
    <>
      <div className="tonightSecondaryLanes tonightSecondaryLanes--mobile">
        <DealsTonightLane rows={secondaryHeroes} anchor={dealAnchor} now={renderedAt} />
      </div>
      <MusicTonightLane rows={secondaryHeroes} asOf={musicLaneObservedAt} />
    </>
  );
  const newsArea = areaNewsSlug(tonightNear);
  const { lead: leadPhoto, pubs: pubPhotos } = tonightPagePhotos(photos, newsArea);
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

      {/* Screen composition follows docs/design/LAUNCH_SCREENS.md: the one
          painted primary, "Open the map", sits in the head with its one
          quiet secondary beside it. The head is short enough now (no credits,
          no chips above the list) that the first pub still clears a phone's
          tab bar with the row in it; the rule and its measure are in
          docs/rules/app-landing-city-and-listing-pages.md. */}
      <Screen
        as="div"
        className="tonightDesktopGrid"
        kicker="Tonight in London"
        title={tonightHeading(localityBasis)}
        titleId="tonight-title"
        primary={
          <Link prefetch={false} href="/map" className="tonightFootLink">
            Open the map
          </Link>
        }
        secondary={
          <Link prefetch={false} href="/near?locate=1">
            Find my pint
          </Link>
        }
      >
      <div className="tonightPrimary" data-status={listingsStatus}>
      {/* The lede membership follows the Tonight rule in
          docs/rules/app-proxy-csp-caching-and-file-tracing.md. Chain blocks
          and cheap pints stay outside it so they cannot lead the answer. */}
      <div className="tonightLedeRegion" data-testid="tonight-lede">
      <TonightHypedPubs
        rows={hypedPubs}
        selectableVenueIds={selectableVenueIds}
        photos={pubPhotos}
      />
      {listingLede ? <p className="screenLede">{listingLede}</p> : null}
      <TonightListingsNotice
        state={listingsState}
        note={listingsNote}
        noteOffersRetry={noteOffersRetry}
        emptyLead={tonightEmptyLead(status, outAnswer, pubSuggestionCount, secondaryMusic.length)}
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
              <ReadyButton
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
              </ReadyButton>
              {facets.map((facet) => (
                <ReadyButton
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
                </ReadyButton>
              ))}
            </div>
          ) : null}

          <ul id="tonight-list" className="tonightList" data-testid="tonight-list">
            {grouped.map((group, groupIndex) => {
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
              const dealEnds = row.kind === "deal" ? dealEndsCaption(row, renderedAt) : null;
              const dealListingAge =
                row.kind === "deal" ? dealListingAgeCaption(row, renderedAt) : null;
              const RowInner = (
                <>
                  <div className="tonightRowMeta">
                    <span className="tonightRowKind" data-kind={row.kind}>
                      <KindIcon size={14} aria-hidden="true" />
                      {meta.label}
                    </span>
                    {newSinceLastLook[groupIndex] ? <NewSinceMarker /> : null}
                    {/* A listing's figure is a deal's or a meal's, never a
                        pint's, so its badge stays neutral: a band is a claim
                        about a pint alone (lib/priceBand.ts). */}
                    {barePrice !== null ? (
                      <PriceBadge className="tonightRowPrice">
                        £{barePrice.toFixed(2)}
                      </PriceBadge>
                    ) : null}
                  </div>
                  <h2 className="tonightRowTitle">{row.title}</h2>
                  <p className="tonightRowPlace">
                    <MapPin size={14} aria-hidden="true" />
                    <span>{row.placeName}</span>
                  </p>
                  <div className="tonightRowFacts">
                    {when ? <span className="tonightRowWhen">{when}</span> : null}
                    {dealEnds ? (
                      <span className="tonightRowEnds">{dealEnds}</span>
                    ) : null}
                    {walk ? (
                      <span className="tonightRowWalk">
                        <Footprints size={14} aria-hidden="true" />
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
                          <ExternalLink size={14} aria-hidden="true" />
                        </>
                      ) : (
                        <>
                          Open on map
                          <ArrowRight size={14} aria-hidden="true" />
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
                      <ArrowRight size={14} aria-hidden="true" />
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
                              <MapPin size={14} aria-hidden="true" />
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
              <ReadyButton
                type="button"
                className="tonightInlineReset"
                onClick={() => setActiveKind(null)}
              >
                Show all
              </ReadyButton>
            </p>
          ) : null}
        </>
      ) : null}

      </div>
      {/* Last orders sits under the lede, never in it: the answer comes first
          and clears the docked consent card on the smallest phone, and its
          list can name a chain pub, which the lede rule keeps out. From 21:30
          the door is marked as the night's lead (TonightLastOrdersDoor). */}
      <TonightLastOrdersDoor
        origin={origin}
        near={tonightNear}
        onShareLocation={requestLocation}
        locating={locationStatus === "requesting"}
      />
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
        <PreparedBriefStamp preparedAt={pagePreparedAt} />
        <TonightUnmatchedNotice out={outAnswer} />
        <TonightProvenanceLines
          provenance={provenance}
          nearestSuffix={nearestPatchSuffix}
          showCredits={ready || empty}
        />
        <TonightShareButton />
      </div>

      {/* The rail's membership and order belong to the Tonight rule in
          docs/rules/app-proxy-csp-caching-and-file-tracing.md. */}
      <aside className="tonightContext" aria-label="Tonight at a glance">
        {/* Wide screens only: the rail is where a reader looks up from the
            list, and on a phone the photograph would stand between the head
            and the first pub (tonight.css). Hidden, the lazy image is never
            fetched. */}
        <TonightRailPhoto photo={leadPhoto} />
        {ready ? (
          <TonightOnTonightSummary
            now={renderedAt}
            facets={displayedFacets}
            rows={summaryRows}
            totalCount={grouped.length}
          />
        ) : null}

      {/* The reader's own saved pubs, before the city's. It draws nothing and
          asks for nothing when nothing is saved (lib/tonightYourPubs.ts). */}
      <TonightYourPubs />

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
          {/* In a quiet hour the Ideas list below carries these same three
              plans as rows, so the chips do not say them a second time. */}
          {(softPlansWindow ? [] : TONIGHT_SOFT_PLAN_CHIPS).map((chip) => (
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

      {secondaryLanes}

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
          <AreaNewsRail area={newsArea} />
        </div>

        {/* What /out carried before it became a redirect here: the open plans
            and the Drink Wall off the Out read this page already holds, then
            tomorrow and the weekend, read only when a day is chosen. Open
            plans come from the browser read alone: the server seed holds
            listings only. */}
        <TonightOpenPlans body={liveOut.body} />
        <TonightLaterListings />
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
        <section className="tonightQuiet tonightSection" aria-labelledby="tonight-quiet-title">
          <h2 className="tonightQuietLede tonightSectionTitle" id="tonight-quiet-title">
            More ways to plan tonight
          </h2>
          <RowList className="tonightQuietList">
            {QUIET_ALTERNATIVES.map((alt) => (
              <RowListItem
                key={alt.title}
                className="tonightQuietRow createFabLane"
                href={alt.href}
                title={alt.title}
                meta={alt.sub}
              />
            ))}
          </RowList>
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
            <LocateFixed size={16} aria-hidden="true" />
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
                <ReadyButton
                  type="button"
                  className="tonightLocationButton"
                  onClick={clearLocation}
                >
                  <X size={16} aria-hidden="true" />
                  {LOCATION_REMOVE_LABEL}
                </ReadyButton>
              ) : (
                <ReadyButton
                  type="button"
                  className="tonightLocationButton"
                  onClick={requestLocation}
                  disabled={locationStatus === "requesting"}
                >
                  <LocateFixed size={16} aria-hidden="true" />
                  {locationStatus === "requesting"
                    ? LOCATION_FINDING_LABEL
                    : locationStatus === "unavailable"
                      ? LOCATION_RETRY_LABEL
                      : LOCATION_SHARE_LABEL[LOCATION_SURFACE]}
                </ReadyButton>
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
