"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Footprints, LocateFixed, MapPin, RotateCw } from "lucide-react";

import { DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import { mapHrefForCity } from "@/lib/cityPreference";
import { PINT_DATASET_OBSERVED_AT, formatMonthYear } from "@/lib/dataFreshness";
import { formatPrice } from "@/lib/venues";
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
};

const GEO_OPTS: PositionOptions = { enableHighAccuracy: false, timeout: 7000, maximumAge: 60_000 };

export default function NearMeNow({
  cityId = DEFAULT_CITY_ID,
  onSelectVenue,
  mapHref,
  autoLocate = false,
  venues,
  initialLocation = null,
}: NearMeNowProps) {
  const router = useRouter();
  // Map mode (initialLocation) resolves an answer on mount — start on the
  // spinner, not the idle CTA, so there is no "Find my pint" flash.
  const [state, setState] = useState<LocateState>(initialLocation ? "requesting" : "idle");
  const [cards, setCards] = useState<NearMeCard[]>([]);
  const [scope, setScope] = useState<NearMeScope>("none");
  const [borough, setBorough] = useState<string | null>(null);
  const [patch, setPatch] = useState<NightPatch | null>(null);
  const [patchReason, setPatchReason] = useState<PatchReason>(null);
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
      void loadSlim().then((slim) => {
        const answer = rankNearMe(next.lat, next.lng, slim);
        setCards(answer.cards);
        setScope(answer.scope);
        setPatch(next);
        setBorough(null);
        if (reason !== null) setPatchReason(reason);
        setState("ready");
        writeRememberedArea({ kind: "patch", id: next.id });
      });
    },
    [loadSlim],
  );

  const pickBorough = useCallback(
    (name: string) => {
      void loadSlim().then((slim) => {
        setCards(rankBoroughCheapest(slim, name));
        setBorough(name);
        setPatch(null);
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
            // Located fine, but nothing priced in range — answer from an area
            // instead of showing a dead end.
            answerWithoutFix("none");
            return;
          }
          setCards(answer.cards);
          setScope(answer.scope);
          setState("ready");
          setBorough(null);
          setPatch(null);
          setPatchReason(null);
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
    if (!autoLocate) return;
    // Kick off geolocation on mount. locate() sets "requesting" then resolves
    // asynchronously via the Geolocation API — an external-system sync, the
    // documented exception to the no-setState-in-effect guidance.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    locate();
    // Mount-only: loadSlim/locate are stable for a given cityId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLocate, initialLocation]);

  const openVenue = useCallback(
    (id: string) => {
      if (onSelectVenue) onSelectVenue(id);
      else router.push(venueMapUrl(id));
    },
    [onSelectVenue, router],
  );

  const collectedLabel = `Prices collected ${formatMonthYear(PINT_DATASET_OBSERVED_AT)}`;
  const areaLabel = borough ?? patch?.label ?? null;
  const patchMessage =
    areaLabel && patchReason
      ? patchReason === "denied"
        ? `Location's off, so here's ${areaLabel}. Not your patch?`
        : patchReason === "none"
          ? `Nothing priced within reach, so here's ${areaLabel}.`
          : `No location on this device, so here's ${areaLabel}.`
      : null;

  return (
    <section className="nmn" aria-label="Cheapest pints near you now">
      {state === "idle" ? (
        <div className="nmnIntro">
          <p className="nmnLede">The cheapest good pints within a short walk, right now.</p>
          <button type="button" className="nmnLocate" onClick={locate}>
            <LocateFixed size={18} aria-hidden="true" /> Find my pint
          </button>
          <p className="nmnHint">We only use your location to rank pubs nearby. Nothing is stored.</p>
        </div>
      ) : null}

      {state === "requesting" ? (
        <div className="nmnStatus" role="status">
          <span className="nmnSpinner" aria-hidden="true" />
          Finding the cheapest pints near you…
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

      {state === "ready" && !borough && !patch ? (
        <>
          <header className="nmnHead">
            <h2>{scope === "widened" ? "Nearest priced pubs" : "Cheapest pints near you"}</h2>
            {scope === "widened" ? (
              <p className="nmnWiden">Not many priced pubs on your doorstep. These are the nearest, a bit further out.</p>
            ) : (
              <p className="nmnSub">Within about a 12-minute walk.</p>
            )}
          </header>
          <NearMeCardList cards={cards} onOpen={openVenue} />
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
          </header>
          <NearMeCardList cards={cards} onOpen={openVenue} />
          {cards.length === 0 ? (
            <p className="nmnSub">Nothing priced here yet. Pick another area.</p>
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

function NearMeCardList({ cards, onOpen }: { cards: NearMeCard[]; onOpen: (id: string) => void }) {
  if (cards.length === 0) return null;
  return (
    <ul className="nmnList">
      {cards.map((card) => (
        <li key={card.id}>
          <button type="button" className="nmnCard" onClick={() => onOpen(card.id)}>
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
          </button>
        </li>
      ))}
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
          {NIGHT_PATCHES.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="nmnBoroughChip"
                data-active={entry.label === activeLabel || undefined}
                tabIndex={open ? undefined : -1}
                onClick={() => {
                  onPickPatch(entry);
                  close();
                }}
              >
                {entry.label}
              </button>
            </li>
          ))}
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
