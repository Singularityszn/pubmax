"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PriceBadge from "@/components/PriceBadge";
import { samePathWithQuery } from "@/lib/appLink";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Footprints, LocateFixed, MapPin, RotateCw } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import type { NearAnswerSource } from "@/lib/analyticsEvents";
import { CITIES, DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { mapHrefForCity } from "@/lib/cityPreference";
import {
  NEAR_PRICE_TRUST_CAPTION,
  nearPriceTrustLabel,
  nearPriceTrustObservedAt,
} from "@/lib/nearPriceTrust";
import { formatPrice } from "@/lib/venues";
import {
  acceptNearVenue,
  VENUE_ACCEPTANCE_STORAGE_ERROR,
  type RawAcceptedArea,
} from "@/lib/venueAcceptance";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { loadSlimVenuesForCity } from "@/lib/venuesSlim";
import {
  boroughsWithPrices,
  formatNearDistance,
  withoutWalkTimes,
  nearMeAnswerHeadline,
  rankBoroughCheapest,
  rankNearMe,
  type NearMeCard,
  type NearMeScope,
  type PricedPoint,
} from "@/lib/nearMeAnswer";
import {
  CENTRAL_PATCH,
  NIGHT_PATCHES,
  readRememberedArea,
  resolveNightPatch,
  writeRememberedArea,
  type NightPatch,
} from "@/lib/nightPatches";
import { nearestSupportedPatch, type NearestPatch } from "@/lib/areaDemand";
import { nearAnswerReadyProps, nearVenueOpenedProps } from "@/lib/nearAnalytics";
import {
  derivePatchCapabilities,
  derivePatchProfile,
  patchIsLimited,
  patchTierLabel,
  summarisePatchEvidence,
  type PatchCapabilityProfile,
} from "@/lib/patchCapabilities";
import UnsupportedAreaPreview from "@/components/coverage/UnsupportedAreaPreview";
import {
  useNearPriceTrust,
  type NearPriceTrustView,
} from "@/components/nearme/useNearPriceTrust";
import NearPriceEvidenceMission from "@/components/nearme/NearPriceEvidenceMission";
import Screen from "@/components/ui/screen";

import "./nearMeNow.css";

type LocateState = "idle" | "requesting" | "ready" | "denied" | "unavailable";

/** Why we're answering from a patch instead of the viewer's own spot. */
type PatchReason = "denied" | "unavailable" | "none" | null;
/** Whether the priced index answered: absent rows and a failed read are two findings. */
type SlimReadState = "unknown" | "ready" | "unavailable";
/** The ask a retry re-runs, recorded by whichever answer path served it. */
type RetryTarget =
  | { kind: "patch"; patch: NightPatch; reason: PatchReason; source: NearAnswerSource }
  | { kind: "borough"; name: string; source: NearAnswerSource };

export type NearMeNowProps = {
  cityId?: CityId | string;
  /**
   * Map context: select the venue in place instead of navigating away. When
   * omitted (landing / /near), a card opens the pub on the map (`?sel=`), which
   * both shows its sheet and centres the map there.
   */
  onSelectVenue?: (id: string) => void;
  /** "Open the full map" target. Defaults to the city map href. */
  mapHref?: string;
  /** Request geolocation as soon as the surface mounts (landing hero / /near). */
  autoLocate?: boolean;
  /**
   * Map mode: priced points already in memory (the map's loaded venues),
   * so the sheet answers without re-fetching the slim index.
   */
  venues?: PricedPoint[];
  /**
   * Map mode: a location the caller already resolved (the map's Near-me
   * geolocation), so the sheet answers immediately without a second prompt.
   */
  initialLocation?: { lat: number; lng: number } | null;
  /**
   * Shareable `/near?patch=soho` entry: answer from that patch centre without
   * prompting for geolocation. Invalid ids are ignored.
   */
  initialPatchId?: string | null;
  /** When true, patch picks rewrite `?patch=` on the current path. */
  syncPatchToUrl?: boolean;
  /** `/near` enables explicit acceptance. Embedded Map answers stay browse-only. */
  allowVenueAcceptance?: boolean;
  /**
   * The host already prints this answer's heading, so print the headline as a
   * plain line instead. The map's near-me sheet is the case: its chrome header
   * carries the sheet's one heading and the dialog's accessible name, and a
   * second heading right under it read as the title twice.
   */
  titledByHost?: boolean;
  /** `/near` only: load bounded baseline publisher evidence for answer rows. */
  showPriceTrust?: boolean;
};

/** The answer's headline, as a heading of its own or the host's plain line. */
function AnswerHeadline({
  text,
  titledByHost,
}: {
  text: string;
  titledByHost: boolean;
}) {
  return titledByHost ? (
    <p className="nmnHeadline">{text}</p>
  ) : (
    <h2>{text}</h2>
  );
}

const GEO_OPTS: PositionOptions = { enableHighAccuracy: false, timeout: 7000, maximumAge: 60_000 };

// The /near heading. It names only what the listed prices guarantee (listed,
// near you, cheapest first), which __tests__/localityTruthCopy.test.ts pins,
// so the launch table's shorter line is not swapped in.
function nearIntroLede(): string {
  return "Compare listed pint prices near you, cheapest first.";
}

/** The active browse area as an acceptance area, or null for a located answer. */
function rawAcceptArea(patch: NightPatch | null, borough: string | null): RawAcceptedArea {
  if (patch) return { kind: "night-patch", id: patch.id };
  if (borough) return { kind: "borough", name: borough };
  return null;
}

/** City to record when the venue id itself does not resolve to a known city. */
function resolveFallbackCityId(cityId: CityId | string): CityId {
  return typeof cityId === "string" && Object.hasOwn(CITIES, cityId)
    ? (cityId as CityId)
    : DEFAULT_CITY_ID;
}

/**
 * The answer's cards plus, on the full Near surface, one explicit acceptance
 * action per Venue. Embedded Map answers keep their compact browse-only rows.
 */
function AnswerCards({
  cards,
  onOpen,
  onAccept,
  accept,
  receipt,
  priceTrust,
}: {
  cards: NearMeCard[];
  onOpen: (id: string) => void;
  onAccept: (id: string) => void;
  accept: boolean;
  receipt: string | null;
  priceTrust?: NearPriceTrustView;
}) {
  return (
    <>
      {accept && receipt && cards.length > 0 ? (
        <p className="nmnAcceptReceipt">{receipt}</p>
      ) : null}
      {accept && cards.length > 0 ? (
        <NearPriceEvidenceMission cards={cards} enabled />
      ) : null}
      <NearMeCardList
        cards={cards}
        onOpen={onOpen}
        onAccept={accept ? onAccept : undefined}
        priceTrust={priceTrust}
      />
    </>
  );
}

/** The active browse area's display label, or null for a located answer. */
function resolveAreaLabel(borough: string | null, patch: NightPatch | null): string | null {
  return borough ?? patch?.label ?? null;
}

/** Pre-action instruction. It never claims a Venue has already been accepted. */
function acceptanceReceiptText(allowVenueAcceptance: boolean): string | null {
  return allowVenueAcceptance ? "Choose a pub to keep for tonight." : null;
}

/** Why we're answering from a patch instead of the viewer's own spot, in words. */
function patchStatusMessage(areaLabel: string | null, patchReason: PatchReason): string | null {
  return areaLabel && patchReason
    ? patchReason === "denied"
      ? `Location's off, so here's ${areaLabel}. Not your patch?`
      : patchReason === "none"
        ? `Nothing priced within reach, so here's ${areaLabel}.`
        : `No location on this device, so here's ${areaLabel}.`
    : null;
}

/**
 * Honest, derived coverage note for the active patch: real priced-pub counts
 * from the slim index in memory, never a uniform claim. Borough view carries
 * no patch profile, so it stays null.
 */
function patchCoverageNote(
  patch: NightPatch | null,
  patchProfile: PatchCapabilityProfile | null,
): string | null {
  return patch && patchProfile ? summarisePatchEvidence(patchProfile) : null;
}

/** Whether the active patch's real coverage is thin (the #474 demand-capture ask). */
function patchCoverageIsLimited(
  patch: NightPatch | null,
  patchProfile: PatchCapabilityProfile | null,
): boolean {
  return Boolean(patch && patchProfile && patchIsLimited(patchProfile));
}

export function shouldResolveInitialNearPatch(
  initialPatchId: string | null | undefined,
  activePatchId: string | null | undefined,
): boolean {
  return Boolean(initialPatchId && initialPatchId !== activePatchId);
}

export function shouldStartNearAutoLocate(input: {
  autoLocate: boolean;
  alreadyStarted: boolean;
  hasInitialLocation: boolean;
  bootPatchId: string | null;
}): boolean {
  return (
    input.autoLocate &&
    !input.alreadyStarted &&
    !input.hasInitialLocation &&
    !input.bootPatchId
  );
}

export default function NearMeNow({
  cityId = DEFAULT_CITY_ID,
  onSelectVenue,
  mapHref,
  autoLocate = false,
  venues,
  initialLocation = null,
  initialPatchId = null,
  syncPatchToUrl = false,
  allowVenueAcceptance = false,
  titledByHost = false,
  showPriceTrust = false,
}: NearMeNowProps) {
  const router = useRouter();
  const pathname = usePathname();
  const bootPatch = resolveNightPatch(initialPatchId);
  // Map mode (initialLocation) resolves an answer on mount — start on the
  // spinner, not the idle CTA, so there is no "Find my pint" flash.
  // Shareable patch links start idle and let pickPatch() flip to requesting
  // so a missed effect can never leave a permanent locate spinner.
  const [state, setState] = useState<LocateState>(initialLocation ? "requesting" : "idle");
  const [cards, setCards] = useState<NearMeCard[]>([]);
  const [scope, setScope] = useState<NearMeScope>("none");
  const [borough, setBorough] = useState<string | null>(null);
  const [patch, setPatch] = useState<NightPatch | null>(null);
  const [patchReason, setPatchReason] = useState<PatchReason>(null);
  // Honest, derived coverage tier for the active patch (Wayfinder 3.1): real
  // priced-pub counts from the slim index in memory, never a uniform claim.
  const [patchProfile, setPatchProfile] = useState<PatchCapabilityProfile | null>(null);
  // Located fine but nothing priced within reach: the honest "we do not cover
  // where you are yet" state, carrying the REAL nearest supported patch.
  const [outsideCoverage, setOutsideCoverage] = useState<NearestPatch | null>(null);
  const [acceptanceError, setAcceptanceError] = useState("");
  const slimRef = useRef<PricedPoint[] | null>(venues ?? null);
  const loadingSlimRef = useRef<Promise<PricedPoint[]> | null>(null);
  // Whether the priced index ANSWERED. A caller in map mode is handed the rows
  // already in memory, so that read has plainly run.
  const [slimRead, setSlimRead] = useState<SlimReadState>(venues ? "ready" : "unknown");
  // What the reader last asked for, so a retry re-answers THAT rather than
  // dropping them back on the idle screen. Recorded as the ask itself rather
  // than as a closure over the answer path, so neither path has to name itself.
  const retryTargetRef = useRef<RetryTarget | null>(null);
  const answerGenerationRef = useRef(0);
  const autoLocateStartedRef = useRef(false);
  const [activeAnswerGeneration, setActiveAnswerGeneration] = useState(0);
  const lastTrackedAnswerRef = useRef(0);
  const [answerContext, setAnswerContext] = useState<{
    source: NearAnswerSource;
    generation: number;
  } | null>(null);
  const beginAnswer = useCallback(() => {
    const generation = ++answerGenerationRef.current;
    setActiveAnswerGeneration(generation);
    return generation;
  }, []);
  const priceTrust = useNearPriceTrust(
    cards,
    showPriceTrust,
    activeAnswerGeneration,
    answerContext?.generation ?? null,
  );

  const resolvedMapHref = mapHref ?? mapHrefForCity(cityId);

  // Resolve the priced index once and memoise on the instance. In map mode the
  // caller hands us `venues` already in memory; otherwise fetch the slim index.
  // Never throws to the caller — a miss yields an empty list so the surface
  // degrades to the patch answer rather than a crash.
  const loadSlim = useCallback(async (): Promise<PricedPoint[]> => {
    if (slimRef.current) return slimRef.current;
    if (!loadingSlimRef.current) {
      loadingSlimRef.current = loadSlimVenuesForCity(cityId)
        .then((rows) => {
          setSlimRead("ready");
          return rows;
        })
        // A READ WE COULD NOT RUN IS NOT AN EMPTY AREA. The empty list stays,
        // because every caller here answers with an area rather than hanging on
        // the locate spinner, but the FAILURE is now recorded beside it: without
        // it, a shard miss printed "We haven't mapped pubs in Clapham yet" with
        // a demand form under it, over a borough this product has mapped for a
        // year (PlanAstra, section 2.4).
        .catch(() => {
          setSlimRead("unavailable");
          return [] as PricedPoint[];
        })
        .then((rows) => {
          slimRef.current = rows;
          return rows;
        });
    }
    return loadingSlimRef.current;
  }, [cityId]);

  // Answer from a patch centre with the same ranker the located path uses, so
  // walk minutes stay real (they read from the patch's walking heart).
  const pickPatch = useCallback(
    (
      next: NightPatch,
      reason: PatchReason = null,
      answerSource: NearAnswerSource = "picked-area",
    ) => {
      const generation = beginAnswer();
      retryTargetRef.current = { kind: "patch", patch: next, reason, source: answerSource };
      setState("requesting");
      setPatch(next);
      setBorough(null);
      setOutsideCoverage(null);
      if (reason !== null) setPatchReason(reason);
      void loadSlim()
        .then((slim) => {
          if (generation !== answerGenerationRef.current) return;
          try {
            const answer = rankNearMe(next.lat, next.lng, slim);
            // A centre the reader fell back to (location off or unavailable)
            // is not where they are standing; its rows carry no walk time.
            const fallbackCentre = reason === "denied" || reason === "unavailable";
            setCards(fallbackCentre ? withoutWalkTimes(answer.cards) : answer.cards);
            setScope(answer.scope);
            // Derive this patch's honest coverage tier from the priced pubs actually
            // in the slim index (real counts, no uniform claim).
            setPatchProfile(derivePatchProfile(next, { venues: slim }));
          } catch {
            setCards([]);
            setScope("none");
            setPatchProfile(null);
          }
          setAnswerContext({ source: answerSource, generation });
          setState("ready");
          writeRememberedArea({ kind: "patch", id: next.id });
          if (syncPatchToUrl && pathname) {
            try {
              const params = new URLSearchParams(
                typeof window !== "undefined" ? window.location.search : "",
              );
              params.set("patch", next.id);
              const query = params.toString();
              router.replace(samePathWithQuery(pathname, query), { scroll: false });
            } catch {
              // URL sync is best-effort — never block the answer.
            }
          }
        })
        .catch(() => {
          if (generation !== answerGenerationRef.current) return;
          // Slim index miss must still surface the chosen patch, never hang on
          // the locate spinner — empty cards + AreaPicker remain available.
          setCards([]);
          setScope("none");
          setPatchProfile(null);
          setAnswerContext({ source: answerSource, generation });
          setState("ready");
        });
    },
    [beginAnswer, loadSlim, pathname, router, syncPatchToUrl],
  );

  const pickBorough = useCallback(
    (name: string, answerSource: NearAnswerSource = "picked-area") => {
      const generation = beginAnswer();
      retryTargetRef.current = { kind: "borough", name, source: answerSource };
      void loadSlim().then((slim) => {
        if (generation !== answerGenerationRef.current) return;
        setCards(rankBoroughCheapest(slim, name));
        setBorough(name);
        setPatch(null);
        setPatchProfile(null);
        setOutsideCoverage(null);
        setScope("walkable");
        setAnswerContext({ source: answerSource, generation });
        setState("ready");
        writeRememberedArea({ kind: "borough", name });
      });
    },
    [beginAnswer, loadSlim],
  );

  /** Ask the index again, then re-answer the ask the reader last made. */
  const retrySlim = useCallback(() => {
    slimRef.current = null;
    loadingSlimRef.current = null;
    setSlimRead("unknown");
    const target = retryTargetRef.current;
    if (!target) return;
    if (target.kind === "patch") pickPatch(target.patch, target.reason, target.source);
    else pickBorough(target.name, target.source);
  }, [pickBorough, pickPatch]);

  // No fix (denied / unavailable / nothing priced in range): answer anyway.
  // Last remembered area first, central London otherwise — the pint before
  // the question, always.
  const answerWithoutFix = useCallback(
    (reason: Exclude<PatchReason, null>) => {
      const remembered = readRememberedArea();
      if (remembered?.kind === "borough") {
        setPatchReason(reason);
        pickBorough(remembered.name, "remembered-area");
        return;
      }
      const rememberedPatch =
        remembered?.kind === "patch" ? resolveNightPatch(remembered.id) : null;
      pickPatch(
        rememberedPatch ?? CENTRAL_PATCH,
        reason,
        rememberedPatch ? "remembered-area" : "default-area",
      );
    },
    [pickBorough, pickPatch],
  );

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      answerWithoutFix("unavailable");
      return;
    }
    const generation = beginAnswer();
    setState("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void loadSlim().then((slim) => {
          if (generation !== answerGenerationRef.current) return;
          const answer = rankNearMe(position.coords.latitude, position.coords.longitude, slim);
          if (answer.scope === "none") {
            // Located fine, but nothing priced in range — be honest that we do
            // not cover here yet, name the REAL nearest patch, and let them
            // register demand, instead of silently pretending central London.
            const nearest = nearestSupportedPatch(
              position.coords.latitude,
              position.coords.longitude,
            );
            if (nearest) {
              setCards([]);
              setBorough(null);
              setPatch(null);
              setPatchProfile(null);
              setPatchReason(null);
              setOutsideCoverage(nearest);
              setAnswerContext({ source: "location", generation });
              setState("ready");
              return;
            }
            // No patch to offer (should not happen) — fall back to an area answer.
            answerWithoutFix("none");
            return;
          }
          setCards(answer.cards);
          setScope(answer.scope);
          setState("ready");
          setBorough(null);
          setPatch(null);
          setPatchProfile(null);
          setPatchReason(null);
          setOutsideCoverage(null);
          setAnswerContext({ source: "location", generation });
        });
      },
      (error) => {
        if (generation !== answerGenerationRef.current) return;
        // PERMISSION_DENIED === 1; anything else (timeout, position
        // unavailable) is treated as unavailable — both answer from an area.
        const reason = error.code === error.PERMISSION_DENIED ? "denied" : "unavailable";
        setState(reason);
        answerWithoutFix(reason);
      },
      GEO_OPTS,
    );
  }, [answerWithoutFix, beginAnswer, loadSlim]);

  useEffect(() => {
    const startAutoLocate = shouldStartNearAutoLocate({
      autoLocate,
      alreadyStarted: autoLocateStartedRef.current,
      hasInitialLocation: Boolean(initialLocation),
      bootPatchId: bootPatch?.id ?? null,
    });
    // Map mode: a location is already resolved — answer immediately, no prompt.
    if (initialLocation) {
      const generation = beginAnswer();
      void loadSlim().then((slim) => {
        if (generation !== answerGenerationRef.current) return;
        const answer = rankNearMe(initialLocation.lat, initialLocation.lng, slim);
        setCards(answer.cards);
        setScope(answer.scope);
        setState("ready");
        setBorough(null);
        setAnswerContext({ source: "location", generation });
      });
      return;
    }
    // Shareable patch entry beats auto-locate so deep links stay honest.
    if (bootPatch) {
      if (shouldResolveInitialNearPatch(bootPatch.id, patch?.id)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        pickPatch(bootPatch, null);
      }
      return;
    }
    if (!startAutoLocate) return;
    autoLocateStartedRef.current = true;
    // Kick off geolocation on mount. locate() sets "requesting" then resolves
    // asynchronously via the Geolocation API — an external-system sync, the
    // documented exception to the no-setState-in-effect guidance.
    locate();
    // Mount-only: loadSlim/locate/pickPatch are stable for a given cityId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLocate, initialLocation, bootPatch?.id]);

  useEffect(() => {
    if (
      !showPriceTrust ||
      state !== "ready" ||
      !answerContext ||
      lastTrackedAnswerRef.current === answerContext.generation
    ) {
      return;
    }
    lastTrackedAnswerRef.current = answerContext.generation;
    trackEvent(
      "near_answer_ready",
      nearAnswerReadyProps(answerContext.source, cards.length),
    );
  }, [answerContext, cards.length, showPriceTrust, state]);

  const openVenue = useCallback(
    (id: string) => {
      if (showPriceTrust && answerContext) {
        const position = cards.findIndex((card) => card.id === id) + 1;
        if (position > 0) {
          trackEvent(
            "near_venue_opened",
            nearVenueOpenedProps(answerContext.source, position),
          );
        }
      }
      if (onSelectVenue) onSelectVenue(id);
      else router.push(venueMapUrl(id));
    },
    [answerContext, cards, onSelectVenue, router, showPriceTrust],
  );

  // Explicit acceptance (§4.8): only "Keep for tonight" reaches here. Opening a card
  // above stays browse-only. Records one PlanningIntent (source "near") carrying
  // the active area, tonight, and the price provenance, then hands the Venue off
  // via the accept deep link. A storage failure stays on Near, reports the error,
  // and emits nothing, so an unrecorded acceptance is never counted. Embedded
  // Map answers never wire this action.
  const acceptVenue = useCallback(
    (id: string) => {
      const result = acceptNearVenue({
        venueId: id,
        area: rawAcceptArea(patch, borough),
        // Near answers "right now"; no explicit future date is chosen.
        startsAt: null,
        observedAt:
          priceTrust && priceTrust !== "loading"
            ? nearPriceTrustObservedAt(priceTrust.results, id)
            : null,
        fallbackCityId: resolveFallbackCityId(cityId),
      });
      if (!result.accepted || !result.telemetry) {
        setAcceptanceError(VENUE_ACCEPTANCE_STORAGE_ERROR);
        return;
      }
      setAcceptanceError("");
      trackEvent("venue_accepted", result.telemetry);
      router.push(result.href);
    },
    [patch, borough, cityId, priceTrust, router],
  );

  const areaLabel = resolveAreaLabel(borough, patch);
  // Pre-action instruction. Shown only when acceptance is available, so the
  // embedded browse-only surface stays uncluttered.
  const acceptReceipt = acceptanceReceiptText(allowVenueAcceptance);
  const patchMessage = patchStatusMessage(areaLabel, patchReason);

  // Honest, derived coverage tier for the active patch. The note reads from real
  // priced-pub counts (slim index in memory); a "limited" patch also gets the
  // #474 demand-capture ask so a thin zone captures demand — value first, always
  // after the pints. Borough view carries no patch profile, so it is skipped.
  const patchEvidenceNote = patchCoverageNote(patch, patchProfile);
  const patchLimited = patchCoverageIsLimited(patch, patchProfile);

  return (
    <section className="nmn" aria-label="Find nearby cheap pints">
      {state === "idle" ? (
        <NearMeIdleIntro
          onLocate={locate}
          onPickPatch={pickPatch}
          titledByHost={titledByHost}
        />
      ) : null}

      {state === "requesting" ? <NearMeRequestingStatus patch={patch} /> : null}

      {state === "denied" || state === "unavailable" ? (
        // answerWithoutFix is already resolving an area answer; this shows only
        // for the beat the slim index takes to arrive.
        <NearMeFallbackStatus />
      ) : null}

      {state === "ready" && outsideCoverage ? (
        <NearMeOutsideCoverage
          outsideCoverage={outsideCoverage}
          onPickPatch={pickPatch}
          onLocate={locate}
        />
      ) : null}

      {state === "ready" && !outsideCoverage && !borough && !patch ? (
        <NearMeLocatedAnswer
          scope={scope}
          titledByHost={titledByHost}
          cards={cards}
          onOpen={openVenue}
          onAccept={acceptVenue}
          allowVenueAcceptance={allowVenueAcceptance}
          acceptReceipt={acceptReceipt}
          acceptanceError={acceptanceError}
          priceTrust={priceTrust}
          resolvedMapHref={resolvedMapHref}
          onLocate={locate}
        />
      ) : null}

      {state === "ready" && areaLabel ? (
        <NearMeAreaAnswer
          scope={scope}
          borough={borough}
          patch={patch}
          patchProfile={patchProfile}
          areaLabel={areaLabel}
          titledByHost={titledByHost}
          patchMessage={patchMessage}
          patchEvidenceNote={patchEvidenceNote}
          patchLimited={patchLimited}
          cards={cards}
          onOpen={openVenue}
          onAccept={acceptVenue}
          allowVenueAcceptance={allowVenueAcceptance}
          acceptReceipt={acceptReceipt}
          acceptanceError={acceptanceError}
          priceTrust={priceTrust}
          slimRead={slimRead}
          loadSlim={loadSlim}
          onPickPatch={pickPatch}
          onPickBorough={pickBorough}
          onLocate={locate}
          onRetrySlim={retrySlim}
        />
      ) : null}
    </section>
  );
}

function NearMeIdleIntro({
  onLocate,
  onPickPatch,
  titledByHost,
}: {
  onLocate: () => void;
  onPickPatch: (patch: NightPatch) => void;
  /** The map's near-me sheet names itself in its chrome, so no kicker there. */
  titledByHost: boolean;
}) {
  const hint = (
    <p className="nmnHint">We only use your location to rank pubs nearby. Nothing is stored.</p>
  );
  const patches = (
    <div className="nmnQuickPatches">
      <p className="nmnQuickPatchesLabel">Or pick a patch</p>
      <ul className="nmnAreaChips" aria-label="Pick an area">
        {NIGHT_PATCHES.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="nmnBoroughChip"
              onClick={() => onPickPatch(entry)}
            >
              {entry.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  // Hosted in the map's near-me sheet: the sheet chrome carries the title, so
  // the intro keeps its own compact head and button.
  if (titledByHost) {
    return (
      <div className="nmnIntro">
        <h1 className="nmnLede">{nearIntroLede()}</h1>
        <button
          type="button"
          className="nmnLocate"
          data-primary-action=""
          onClick={onLocate}
        >
          <LocateFixed size={18} aria-hidden="true" /> Find my pint
        </button>
        {hint}
        {patches}
      </div>
    );
  }

  // The /near route: the head is the Screen primitive
  // (docs/design/LAUNCH_SCREENS.md), and Find my pint is its one primary. The
  // patch chips underneath are the way onward without granting location.
  return (
    <Screen
      as="div"
      className="nmnScreen"
      kicker="Near you"
      title={nearIntroLede()}
      titleId="near-title"
      primary={
        <button type="button" onClick={onLocate}>
          <LocateFixed size={18} aria-hidden="true" /> Find my pint
        </button>
      }
    >
      {hint}
      {patches}
    </Screen>
  );
}

function NearMeRequestingStatus({ patch }: { patch: NightPatch | null }) {
  return (
    <div className="nmnStatus" role="status">
      <span className="nmnSpinner" aria-hidden="true" />
      {patch
        ? `Checking listed pint prices around ${patch.label}…`
        : "Checking listed pint prices near you…"}
    </div>
  );
}

/**
 * The index would not answer.
 *
 * NOT the coverage card: that one says "We haven't mapped pubs in {area} yet"
 * and offers a form asking us to map it, which over a borough we have mapped
 * for a year is a claim about the AREA made from a fact about US (PlanAstra,
 * section 2.4). This says what happened and offers the one thing that helps.
 */
export function NearMeReadUnavailable({
  areaLabel,
  onRetry,
}: {
  areaLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="nmnStatus nmnStatusFail" role="status">
      <p>We could not read the pub list for {areaLabel} just now.</p>
      <button type="button" className="nmnRetry nmnRetryGhost" onClick={onRetry}>
        <RotateCw size={15} aria-hidden="true" /> Try again
      </button>
    </div>
  );
}

function NearMeFallbackStatus() {
  return (
    <div className="nmnStatus" role="status">
      <span className="nmnSpinner" aria-hidden="true" />
      Checking listed pint prices in town…
    </div>
  );
}

function NearMeOutsideCoverage({
  outsideCoverage,
  onPickPatch,
  onLocate,
}: {
  outsideCoverage: NearestPatch;
  onPickPatch: (patch: NightPatch) => void;
  onLocate: () => void;
}) {
  return (
    <div className="nmnOutside">
      <UnsupportedAreaPreview
        nearest={outsideCoverage}
        source="near-empty"
        onPickPatch={onPickPatch}
      />
      <footer className="nmnFoot nmnFootArea">
        <button type="button" className="nmnRetry nmnRetryGhost" onClick={onLocate}>
          <LocateFixed size={15} aria-hidden="true" /> Try my location again
        </button>
      </footer>
    </div>
  );
}

function NearMeLocatedAnswer({
  scope,
  titledByHost,
  cards,
  onOpen,
  onAccept,
  allowVenueAcceptance,
  acceptReceipt,
  acceptanceError,
  priceTrust,
  resolvedMapHref,
  onLocate,
}: {
  scope: NearMeScope;
  titledByHost: boolean;
  cards: NearMeCard[];
  onOpen: (id: string) => void;
  onAccept: (id: string) => void;
  allowVenueAcceptance: boolean;
  acceptReceipt: string | null;
  acceptanceError: string;
  priceTrust?: NearPriceTrustView;
  resolvedMapHref: string;
  onLocate: () => void;
}) {
  return (
    <>
      <header className="nmnHead">
        <AnswerHeadline
          text={nearMeAnswerHeadline({ scope })}
          titledByHost={titledByHost}
        />
        {scope === "widened" ? (
          <p className="nmnWiden">Not many priced pubs on your doorstep. These are the nearest, a bit further out.</p>
        ) : (
          <p className="nmnSub">Within about a 12-minute walk.</p>
        )}
      </header>
      <AnswerCards
        cards={cards}
        onOpen={onOpen}
        onAccept={onAccept}
        accept={allowVenueAcceptance}
        receipt={acceptReceipt}
        priceTrust={priceTrust}
      />
      {acceptanceError ? <p className="nmnAcceptError" role="alert">{acceptanceError}</p> : null}
      <footer className="nmnFoot">
        <a className="nmnRetry" href={resolvedMapHref}>
          <MapPin size={16} aria-hidden="true" /> Open the full map
        </a>
        <button type="button" className="nmnRetry nmnRetryGhost" onClick={onLocate}>
          <RotateCw size={15} aria-hidden="true" /> Update location
        </button>
      </footer>
    </>
  );
}

function NearMeAreaAnswer({
  scope,
  borough,
  patch,
  patchProfile,
  areaLabel,
  titledByHost,
  patchMessage,
  patchEvidenceNote,
  patchLimited,
  cards,
  onOpen,
  onAccept,
  allowVenueAcceptance,
  acceptReceipt,
  acceptanceError,
  priceTrust,
  slimRead,
  loadSlim,
  onPickPatch,
  onPickBorough,
  onLocate,
  onRetrySlim,
}: {
  scope: NearMeScope;
  borough: string | null;
  patch: NightPatch | null;
  patchProfile: PatchCapabilityProfile | null;
  areaLabel: string;
  titledByHost: boolean;
  patchMessage: string | null;
  patchEvidenceNote: string | null;
  patchLimited: boolean;
  cards: NearMeCard[];
  onOpen: (id: string) => void;
  onAccept: (id: string) => void;
  allowVenueAcceptance: boolean;
  acceptReceipt: string | null;
  acceptanceError: string;
  priceTrust?: NearPriceTrustView;
  slimRead: SlimReadState;
  loadSlim: () => Promise<PricedPoint[]>;
  onPickPatch: (patch: NightPatch) => void;
  onPickBorough: (name: string) => void;
  onLocate: () => void;
  onRetrySlim: () => void;
}) {
  return (
    <>
      <header className="nmnHead">
        <AnswerHeadline
          text={nearMeAnswerHeadline({
            scope,
            borough,
            patchLabel: patch?.label ?? null,
          })}
          titledByHost={titledByHost}
        />
        {patchMessage ? <p className="nmnSub">{patchMessage}</p> : null}
        {patchEvidenceNote ? <p className="nmnPatchTier">{patchEvidenceNote}</p> : null}
      </header>
      <AnswerCards
        cards={cards}
        onOpen={onOpen}
        onAccept={onAccept}
        accept={allowVenueAcceptance}
        receipt={acceptReceipt}
        priceTrust={priceTrust}
      />
      {acceptanceError ? <p className="nmnAcceptError" role="alert">{acceptanceError}</p> : null}
      {cards.length === 0 && slimRead === "unavailable" ? (
        <NearMeReadUnavailable areaLabel={areaLabel} onRetry={onRetrySlim} />
      ) : cards.length === 0 ? (
        <div className="nmnOutside">
          <UnsupportedAreaPreview
            area={areaLabel}
            source="area-picker"
            onPickPatch={onPickPatch}
          />
        </div>
      ) : patchLimited ? (
        // Covered but thin: pints shown above, now capture demand for MORE
        // here (the #474 seam wired to LIMITED patches, not just unsupported).
        <div className="nmnOutside">
          <UnsupportedAreaPreview
            area={areaLabel}
            variant="limited"
            evidenceNote={patchProfile?.prices.explanation ?? null}
            source="area-picker"
            onPickPatch={onPickPatch}
          />
        </div>
      ) : null}
      <footer className="nmnFoot nmnFootArea">
        <AreaPicker
          activeLabel={areaLabel}
          loadSlim={loadSlim}
          onPickPatch={onPickPatch}
          onPickBorough={onPickBorough}
        />
        <button type="button" className="nmnRetry nmnRetryGhost" onClick={onLocate}>
          <LocateFixed size={15} aria-hidden="true" /> Try my location again
        </button>
      </footer>
    </>
  );
}

/** The one caption for the whole list. It heads the list; it never rides a row. */
export const NEAR_ME_PRICE_CAPTION = "Cheapest pint";

function collectedPriceLabel(): string {
  return NEAR_PRICE_TRUST_CAPTION;
}

function trustLabelForCard(
  card: NearMeCard,
  priceTrust: NearPriceTrustView | undefined,
): string | null {
  if (!priceTrust) return null;
  if (priceTrust === "loading") return nearPriceTrustLabel("loading");
  const match = priceTrust.results.find(
    (item) => item.venueId === card.id && item.price === card.cheapestPrice,
  );
  if (!match) return nearPriceTrustLabel("degraded");
  return match.publisher
    ? nearPriceTrustLabel("named", match.publisher, match.observedAt)
    : nearPriceTrustLabel("unrecorded", null, match.observedAt);
}

function NearMeCardBody({
  card,
  trustLabel,
}: {
  card: NearMeCard;
  trustLabel: string | null;
}) {
  const distance = formatNearDistance(card.distanceKm);
  return (
    <>
      <span className="nmnCardMain">
        <span className="nmnCardName">{card.name}</span>
        <span className="nmnCardMeta">
          <span className="nmnCardBorough">{card.borough}</span>
          {card.walkMinutes != null ? (
            <span className="nmnCardWalk">
              <Footprints size={13} aria-hidden="true" />
              {card.walkMinutes} min
              {distance ? ` · ${distance}` : null}
            </span>
          ) : null}
        </span>
        {trustLabel ? <span className="nmnCardTrust">{trustLabel}</span> : null}
      </span>
      <span className="nmnCardPrice">
        {/* The figure is a plaque wearing its price BAND (lib/priceBand.ts):
            red expensive, yellow average, green cheap. It used to be green
            text on every row, which told a reader every pint here was cheap. */}
        <PriceBadge
          className="nmnCardPriceValue"
          band={priceBand(card.cheapestPrice, priceBandAreaForVenue(card.id))}
        >
          {formatPrice(card.cheapestPrice)}
        </PriceBadge>
      </span>
    </>
  );
}

/**
 * The answer list. Rows are hairline-divided list items, not stacked raised
 * boxes, and the price caption is printed ONCE as the list's own column header
 * (design judgement 2026-08-01, finding 2.13). Repeating it on every row spent
 * a full column saying the same thing five times, and it was the column that
 * squeezed the pub's name into an ellipsis.
 */
export function NearMeCardList({
  cards,
  onOpen,
  onAccept,
  priceTrust,
}: {
  cards: NearMeCard[];
  onOpen: (id: string) => void;
  /**
   * When present, each card gains a distinct acceptance action beside the
   * browse tap. When absent, the card is the exact
   * browse-only button it has always been.
   */
  onAccept?: (id: string) => void;
  /** `/near` only. Embedded map answers omit this and keep their compact rows. */
  priceTrust?: NearPriceTrustView;
}) {
  if (cards.length === 0) return null;
  const collectedLabel =
    priceTrust && priceTrust !== "loading"
      ? collectedPriceLabel()
      : null;
  return (
    <>
    <p className="nmnListCaption">{NEAR_ME_PRICE_CAPTION}</p>
    <ul className="nmnList">
      {cards.map((card) =>
        onAccept ? (
          <li key={card.id} className="nmnCardRow">
            <button type="button" className="nmnCard nmnCardBrowse" onClick={() => onOpen(card.id)}>
              <NearMeCardBody card={card} trustLabel={trustLabelForCard(card, priceTrust)} />
            </button>
            <button
              type="button"
              className="nmnAccept"
              aria-label={`Keep ${card.name} for tonight`}
              onClick={() => onAccept(card.id)}
            >
              Keep for tonight
            </button>
          </li>
        ) : (
          <li key={card.id}>
            <button type="button" className="nmnCard" onClick={() => onOpen(card.id)}>
              <NearMeCardBody card={card} trustLabel={trustLabelForCard(card, priceTrust)} />
            </button>
          </li>
        ),
      )}
    </ul>
    {collectedLabel ? <p className="nmnPriceCollected">{collectedLabel}</p> : null}
    </>
  );
}

/**
 * Compact area chooser. Eight night patches people actually say, in nightlife
 * order — the full borough list demoted behind "More areas". Renders as a
 * floating panel (transform/opacity only) so opening it never shifts the cards.
 */
function AreaPicker({
  activeLabel,
  loadSlim,
  onPickPatch,
  onPickBorough,
}: {
  activeLabel: string;
  loadSlim: () => Promise<PricedPoint[]>;
  onPickPatch: (patch: NightPatch) => void;
  onPickBorough: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showBoroughs, setShowBoroughs] = useState(false);
  const [boroughs, setBoroughs] = useState<string[]>([]);
  // Honest per-patch tiers (Wayfinder 3.1), derived once the panel opens from the
  // priced pubs actually in the slim index — a lightly-covered patch chip says so
  // instead of every chip reading identically supported.
  const [patchProfiles, setPatchProfiles] =
    useState<Record<string, PatchCapabilityProfile> | null>(null);

  useEffect(() => {
    if (!showBoroughs || boroughs.length > 0) return;
    let alive = true;
    void loadSlim().then((slim) => {
      if (alive) setBoroughs(boroughsWithPrices(slim));
    });
    return () => {
      alive = false;
    };
  }, [showBoroughs, boroughs.length, loadSlim]);

  useEffect(() => {
    if (!open || patchProfiles) return;
    let alive = true;
    void loadSlim().then((slim) => {
      if (alive) setPatchProfiles(derivePatchCapabilities({ venues: slim }));
    });
    return () => {
      alive = false;
    };
  }, [open, patchProfiles, loadSlim]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    setOpen(false);
    setShowBoroughs(false);
  };

  return (
    <div className="nmnArea">
      <button
        type="button"
        className="nmnRetry"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <MapPin size={15} aria-hidden="true" /> Change area
        <ChevronDown size={14} aria-hidden="true" className={open ? "nmnAreaCaretOpen" : undefined} />
      </button>
      <div className={`nmnAreaPanel${open ? " nmnAreaPanelOpen" : ""}`} aria-hidden={!open}>
        <ul className="nmnAreaChips" aria-label="Pick an area">
          {NIGHT_PATCHES.map((entry) => {
            const profile = patchProfiles?.[entry.id];
            const lightly = profile ? patchIsLimited(profile) : false;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="nmnBoroughChip"
                  data-active={entry.label === activeLabel || undefined}
                  data-lightly={lightly || undefined}
                  tabIndex={open ? undefined : -1}
                  title={profile ? patchTierLabel(profile) : undefined}
                  onClick={() => {
                    onPickPatch(entry);
                    close();
                  }}
                >
                  {entry.label}
                  {lightly ? <span className="nmnChipTier">Lightly covered</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {showBoroughs ? (
          <ul className="nmnAreaChips nmnAreaBoroughs" aria-label="All London boroughs">
            {boroughs.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className="nmnBoroughChip"
                  data-active={name === activeLabel || undefined}
                  tabIndex={open ? undefined : -1}
                  onClick={() => {
                    onPickBorough(name);
                    close();
                  }}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <button
            type="button"
            className="nmnAreaMore"
            tabIndex={open ? undefined : -1}
            onClick={() => setShowBoroughs(true)}
          >
            More areas <ChevronDown size={13} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
