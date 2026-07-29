"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Footprints, LocateFixed, MapPin, RotateCw } from "lucide-react";

import { trackEvent } from "@/lib/analytics";
import { CITIES, DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { mapHrefForCity } from "@/lib/cityPreference";
import { PINT_DATASET_OBSERVED_AT, formatMonthYear } from "@/lib/dataFreshness";
import { formatPrice } from "@/lib/venues";
import { acceptNearVenue, type RawAcceptedArea } from "@/lib/venueAcceptance";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { loadSlimVenuesForCity } from "@/lib/venuesSlim";
import {
  boroughsWithPrices,
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
import {
  derivePatchCapabilities,
  derivePatchProfile,
  patchIsLimited,
  patchTierLabel,
  summarisePatchEvidence,
  type PatchCapabilityProfile,
} from "@/lib/patchCapabilities";
import UnsupportedAreaPreview from "@/components/coverage/UnsupportedAreaPreview";

import "./nearMeNow.css";

type LocateState = "idle" | "requesting" | "ready" | "denied" | "unavailable";

/** Why we're answering from a patch instead of the viewer's own spot. */
type PatchReason = "denied" | "unavailable" | "none" | null;

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
  /**
   * Trusted-handoff intent-write flag (`PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE`),
   * delivered as a server-owned DTO by the caller — never read from the env on
   * the client. Off (the default) keeps every card a browse-only link exactly
   * as before. On adds an explicit "Use this pub" acceptance to each card that
   * records a PlanningIntent (source `near`) and hands the Venue off as
   * accepted, distinct from opening it for a look.
   */
  intentWrite?: boolean;
};

const GEO_OPTS: PositionOptions = { enableHighAccuracy: false, timeout: 7000, maximumAge: 60_000 };

function nearIntroLede(observedAt: Date): string {
  return `Find the cheapest good pints within a short walk, using prices collected ${formatMonthYear(observedAt)}.`;
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
 * The answer's cards plus, when acceptance is live, the evidence receipt above
 * them and a "Use this pub" affordance on each. With `accept` off this is the
 * exact browse-only list it has always been.
 */
function AnswerCards({
  cards,
  onOpen,
  onAccept,
  accept,
  receipt,
}: {
  cards: NearMeCard[];
  onOpen: (id: string) => void;
  onAccept: (id: string) => void;
  accept: boolean;
  receipt: string | null;
}) {
  return (
    <>
      {accept && receipt && cards.length > 0 ? (
        <p className="nmnAcceptReceipt">{receipt}</p>
      ) : null}
      <NearMeCardList cards={cards} onOpen={onOpen} onAccept={accept ? onAccept : undefined} />
    </>
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
  intentWrite = false,
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
  const slimRef = useRef<PricedPoint[] | null>(venues ?? null);
  const loadingSlimRef = useRef<Promise<PricedPoint[]> | null>(null);

  const resolvedMapHref = mapHref ?? mapHrefForCity(cityId);

  // Resolve the priced index once and memoise on the instance. In map mode the
  // caller hands us `venues` already in memory; otherwise fetch the slim index.
  // Never throws to the caller — a miss yields an empty list so the surface
  // degrades to the patch answer rather than a crash.
  const loadSlim = useCallback(async (): Promise<PricedPoint[]> => {
    if (slimRef.current) return slimRef.current;
    if (!loadingSlimRef.current) {
      loadingSlimRef.current = loadSlimVenuesForCity(cityId)
        .catch(() => [] as PricedPoint[])
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
    (next: NightPatch, reason: PatchReason = null) => {
      setState("requesting");
      setPatch(next);
      setBorough(null);
      setOutsideCoverage(null);
      if (reason !== null) setPatchReason(reason);
      void loadSlim()
        .then((slim) => {
          try {
            const answer = rankNearMe(next.lat, next.lng, slim);
            setCards(answer.cards);
            setScope(answer.scope);
            // Derive this patch's honest coverage tier from the priced pubs actually
            // in the slim index (real counts, no uniform claim).
            setPatchProfile(derivePatchProfile(next, { venues: slim }));
          } catch {
            setCards([]);
            setScope("none");
            setPatchProfile(null);
          }
          setState("ready");
          writeRememberedArea({ kind: "patch", id: next.id });
          if (syncPatchToUrl && pathname) {
            try {
              const params = new URLSearchParams(
                typeof window !== "undefined" ? window.location.search : "",
              );
              params.set("patch", next.id);
              const query = params.toString();
              router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
            } catch {
              // URL sync is best-effort — never block the answer.
            }
          }
        })
        .catch(() => {
          // Slim index miss must still surface the chosen patch, never hang on
          // the locate spinner — empty cards + AreaPicker remain available.
          setCards([]);
          setScope("none");
          setPatchProfile(null);
          setState("ready");
        });
    },
    [loadSlim, pathname, router, syncPatchToUrl],
  );

  const pickBorough = useCallback(
    (name: string) => {
      void loadSlim().then((slim) => {
        setCards(rankBoroughCheapest(slim, name));
        setBorough(name);
        setPatch(null);
        setPatchProfile(null);
        setOutsideCoverage(null);
        setScope("walkable");
        setState("ready");
        writeRememberedArea({ kind: "borough", name });
      });
    },
    [loadSlim],
  );

  // No fix (denied / unavailable / nothing priced in range): answer anyway.
  // Last remembered area first, central London otherwise — the pint before
  // the question, always.
  const answerWithoutFix = useCallback(
    (reason: Exclude<PatchReason, null>) => {
      const remembered = readRememberedArea();
      if (remembered?.kind === "borough") {
        setPatchReason(reason);
        pickBorough(remembered.name);
        return;
      }
      const rememberedPatch =
        remembered?.kind === "patch" ? resolveNightPatch(remembered.id) : null;
      pickPatch(rememberedPatch ?? CENTRAL_PATCH, reason);
    },
    [pickBorough, pickPatch],
  );

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      answerWithoutFix("unavailable");
      return;
    }
    setState("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void loadSlim().then((slim) => {
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
        });
      },
      (error) => {
        // PERMISSION_DENIED === 1; anything else (timeout, position
        // unavailable) is treated as unavailable — both answer from an area.
        const reason = error.code === error.PERMISSION_DENIED ? "denied" : "unavailable";
        setState(reason);
        answerWithoutFix(reason);
      },
      GEO_OPTS,
    );
  }, [loadSlim, answerWithoutFix]);

  useEffect(() => {
    // Map mode: a location is already resolved — answer immediately, no prompt.
    if (initialLocation) {
      void loadSlim().then((slim) => {
        const answer = rankNearMe(initialLocation.lat, initialLocation.lng, slim);
        setCards(answer.cards);
        setScope(answer.scope);
        setState("ready");
        setBorough(null);
      });
      return;
    }
    // Shareable patch entry beats auto-locate so deep links stay honest.
    if (bootPatch) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      pickPatch(bootPatch, null);
      return;
    }
    if (!autoLocate) return;
    // Kick off geolocation on mount. locate() sets "requesting" then resolves
    // asynchronously via the Geolocation API — an external-system sync, the
    // documented exception to the no-setState-in-effect guidance.
    locate();
    // Mount-only: loadSlim/locate/pickPatch are stable for a given cityId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLocate, initialLocation, bootPatch?.id]);

  const openVenue = useCallback(
    (id: string) => {
      if (onSelectVenue) onSelectVenue(id);
      else router.push(venueMapUrl(id));
    },
    [onSelectVenue, router],
  );

  // Explicit acceptance (§4.8): only "Use this pub" reaches here — opening a card
  // above stays browse-only. Records one PlanningIntent (source "near") carrying
  // the active area, tonight, and the price provenance, then hands the Venue off
  // via the accept deep link. A storage failure degrades to a browse selection
  // (canonical `?sel=`) and emits nothing, so an unrecorded acceptance is never
  // counted. Never fires with intentWrite off.
  const acceptVenue = useCallback(
    (id: string) => {
      const result = acceptNearVenue({
        venueId: id,
        area: rawAcceptArea(patch, borough),
        // Near answers "right now"; no explicit future date is chosen.
        startsAt: null,
        observedAt: PINT_DATASET_OBSERVED_AT.toISOString(),
        fallbackCityId: resolveFallbackCityId(cityId),
      });
      if (result.telemetry) trackEvent("venue_accepted", result.telemetry);
      router.push(result.href);
    },
    [patch, borough, cityId, router],
  );

  const collectedLabel = `Prices collected ${formatMonthYear(PINT_DATASET_OBSERVED_AT)}`;
  const areaLabel = borough ?? patch?.label ?? null;
  // Evidence receipt (§L06): what "Use this pub" carries into the plan. Shown
  // only when acceptance is live, so the browse-only surface stays uncluttered.
  const acceptReceipt = intentWrite
    ? `Keeps ${areaLabel ?? "this pub"}, tonight, and the ${formatMonthYear(PINT_DATASET_OBSERVED_AT)} price in your plan.`
    : null;
  const patchMessage =
    areaLabel && patchReason
      ? patchReason === "denied"
        ? `Location's off, so here's ${areaLabel}. Not your patch?`
        : patchReason === "none"
          ? `Nothing priced within reach, so here's ${areaLabel}.`
          : `No location on this device, so here's ${areaLabel}.`
      : null;

  // Honest, derived coverage tier for the active patch. The note reads from real
  // priced-pub counts (slim index in memory); a "limited" patch also gets the
  // #474 demand-capture ask so a thin zone captures demand — value first, always
  // after the pints. Borough view carries no patch profile, so it is skipped.
  const patchEvidenceNote = patch && patchProfile ? summarisePatchEvidence(patchProfile) : null;
  const patchLimited = Boolean(patch && patchProfile && patchIsLimited(patchProfile));

  return (
    <section className="nmn" aria-label="Find nearby cheap pints">
      {state === "idle" ? (
        <div className="nmnIntro">
          <p className="nmnLede">{nearIntroLede(PINT_DATASET_OBSERVED_AT)}</p>
          <button type="button" className="nmnLocate" onClick={locate}>
            <LocateFixed size={18} aria-hidden="true" /> Find my pint
          </button>
          <p className="nmnHint">We only use your location to rank pubs nearby. Nothing is stored.</p>
          <div className="nmnQuickPatches">
            <p className="nmnQuickPatchesLabel">Or pick a patch</p>
            <ul className="nmnAreaChips" aria-label="Pick a night area">
              {NIGHT_PATCHES.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className="nmnBoroughChip"
                    onClick={() => pickPatch(entry)}
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {state === "requesting" ? (
        <div className="nmnStatus" role="status">
          <span className="nmnSpinner" aria-hidden="true" />
          {patch
            ? `Finding the cheapest pints around ${patch.label}…`
            : "Finding the cheapest pints near you…"}
        </div>
      ) : null}

      {state === "denied" || state === "unavailable" ? (
        // answerWithoutFix is already resolving an area answer; this shows only
        // for the beat the slim index takes to arrive.
        <div className="nmnStatus" role="status">
          <span className="nmnSpinner" aria-hidden="true" />
          Pulling up the cheapest pints in town…
        </div>
      ) : null}

      {state === "ready" && outsideCoverage ? (
        <div className="nmnOutside">
          <UnsupportedAreaPreview
            nearest={outsideCoverage}
            source="near-empty"
            onPickPatch={(next: NightPatch) => pickPatch(next)}
          />
          <footer className="nmnFoot nmnFootArea">
            <button type="button" className="nmnRetry nmnRetryGhost" onClick={locate}>
              <LocateFixed size={15} aria-hidden="true" /> Try my location again
            </button>
          </footer>
        </div>
      ) : null}

      {state === "ready" && !outsideCoverage && !borough && !patch ? (
        <>
          <header className="nmnHead">
            <h2>{scope === "widened" ? "Nearest priced pubs" : "Cheapest pints near you"}</h2>
            {scope === "widened" ? (
              <p className="nmnWiden">Not many priced pubs on your doorstep. These are the nearest, a bit further out.</p>
            ) : (
              <p className="nmnSub">Within about a 12-minute walk.</p>
            )}
          </header>
          <AnswerCards
            cards={cards}
            onOpen={openVenue}
            onAccept={acceptVenue}
            accept={intentWrite}
            receipt={acceptReceipt}
          />
          <footer className="nmnFoot">
            <a className="nmnRetry" href={resolvedMapHref}>
              <MapPin size={16} aria-hidden="true" /> Open the full map
            </a>
            <button type="button" className="nmnRetry nmnRetryGhost" onClick={locate}>
              <RotateCw size={15} aria-hidden="true" /> Update location
            </button>
          </footer>
          <p className="nmnFresh">{collectedLabel}</p>
        </>
      ) : null}

      {state === "ready" && areaLabel ? (
        <>
          <header className="nmnHead">
            <h2>{borough ? `Cheapest in ${borough}` : `Cheapest around ${patch?.label}`}</h2>
            {patchMessage ? <p className="nmnSub">{patchMessage}</p> : null}
            {patchEvidenceNote ? <p className="nmnPatchTier">{patchEvidenceNote}</p> : null}
          </header>
          <AnswerCards
            cards={cards}
            onOpen={openVenue}
            onAccept={acceptVenue}
            accept={intentWrite}
            receipt={acceptReceipt}
          />
          {cards.length === 0 ? (
            <div className="nmnOutside">
              <UnsupportedAreaPreview
                area={areaLabel}
                source="area-picker"
                onPickPatch={(next: NightPatch) => pickPatch(next)}
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
                onPickPatch={(next: NightPatch) => pickPatch(next)}
              />
            </div>
          ) : null}
          <footer className="nmnFoot nmnFootArea">
            <AreaPicker
              activeLabel={areaLabel}
              loadSlim={loadSlim}
              onPickPatch={(next) => pickPatch(next)}
              onPickBorough={pickBorough}
            />
            <button type="button" className="nmnRetry nmnRetryGhost" onClick={locate}>
              <LocateFixed size={15} aria-hidden="true" /> Try my location again
            </button>
          </footer>
          <p className="nmnFresh">{collectedLabel}</p>
        </>
      ) : null}
    </section>
  );
}

function NearMeCardBody({ card }: { card: NearMeCard }) {
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
              {card.distanceKm != null ? ` · ${card.distanceKm.toFixed(1)} km` : null}
            </span>
          ) : null}
        </span>
      </span>
      <span className="nmnCardPrice">
        <span className="nmnCardPriceValue">{formatPrice(card.cheapestPrice)}</span>
        <span className="nmnCardPriceLabel">cheapest pint</span>
      </span>
    </>
  );
}

function NearMeCardList({
  cards,
  onOpen,
  onAccept,
}: {
  cards: NearMeCard[];
  onOpen: (id: string) => void;
  /**
   * When present (intent-write on), each card gains a distinct "Use this pub"
   * acceptance beside the browse tap. When absent, the card is the exact
   * browse-only button it has always been.
   */
  onAccept?: (id: string) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <ul className="nmnList">
      {cards.map((card) =>
        onAccept ? (
          <li key={card.id} className="nmnCardRow">
            <button type="button" className="nmnCard nmnCardBrowse" onClick={() => onOpen(card.id)}>
              <NearMeCardBody card={card} />
            </button>
            <button
              type="button"
              className="nmnAccept"
              aria-label={`Use ${card.name} for your plan`}
              onClick={() => onAccept(card.id)}
            >
              Use this pub
            </button>
          </li>
        ) : (
          <li key={card.id}>
            <button type="button" className="nmnCard" onClick={() => onOpen(card.id)}>
              <NearMeCardBody card={card} />
            </button>
          </li>
        ),
      )}
    </ul>
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
        <ul className="nmnAreaChips" aria-label="Pick a night area">
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
