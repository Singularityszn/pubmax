"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Footprints, LocateFixed, MapPin, RotateCw } from "lucide-react";

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

import "./nearMeNow.css";

type LocateState = "idle" | "requesting" | "ready" | "denied" | "unavailable";

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
  const slimRef = useRef<PricedPoint[] | null>(venues ?? null);
  const loadingSlimRef = useRef<Promise<PricedPoint[]> | null>(null);

  const resolvedMapHref = mapHref ?? mapHrefForCity(cityId);

  // Resolve the priced index once and memoise on the instance. In map mode the
  // caller hands us `venues` already in memory; otherwise fetch the slim index.
  // Never throws to the caller — a miss yields an empty list so the surface
  // degrades to the borough picker rather than a crash.
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

  const locate = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      void loadSlim();
      return;
    }
    setState("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void loadSlim().then((slim) => {
          const answer = rankNearMe(position.coords.latitude, position.coords.longitude, slim);
          setCards(answer.cards);
          setScope(answer.scope);
          setState("ready");
          setBorough(null);
        });
      },
      (error) => {
        // PERMISSION_DENIED === 1; anything else (timeout, position unavailable)
        // is treated as unavailable — both routes lead to the borough picker.
        setState(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
        void loadSlim();
      },
      GEO_OPTS,
    );
  }, [loadSlim]);

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

  const pickBorough = useCallback(
    (name: string) => {
      void loadSlim().then((slim) => {
        setCards(rankBoroughCheapest(slim, name));
        setBorough(name);
        setScope("walkable");
      });
    },
    [loadSlim],
  );

  const openVenue = useCallback(
    (id: string) => {
      if (onSelectVenue) onSelectVenue(id);
      else router.push(venueMapUrl(id));
    },
    [onSelectVenue, router],
  );

  const collectedLabel = `Prices collected ${formatMonthYear(PINT_DATASET_OBSERVED_AT)}`;

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

      {state === "ready" && !borough ? (
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
          {cards.length === 0 ? (
            <BoroughPicker onPick={pickBorough} loadSlim={loadSlim} reason="none" />
          ) : (
            <footer className="nmnFoot">
              <a className="nmnRetry" href={resolvedMapHref}>
                <MapPin size={16} aria-hidden="true" /> Open the full map
              </a>
              <button type="button" className="nmnRetry nmnRetryGhost" onClick={locate}>
                <RotateCw size={15} aria-hidden="true" /> Update location
              </button>
            </footer>
          )}
          <p className="nmnFresh">{collectedLabel}</p>
        </>
      ) : null}

      {state === "ready" && borough ? (
        <>
          <header className="nmnHead">
            <h2>Cheapest in {borough}</h2>
            <button type="button" className="nmnBack" onClick={locate}>
              <LocateFixed size={15} aria-hidden="true" /> Use my location instead
            </button>
          </header>
          <NearMeCardList cards={cards} onOpen={openVenue} />
          <p className="nmnFresh">{collectedLabel}</p>
        </>
      ) : null}

      {state === "denied" || state === "unavailable" ? (
        <BoroughPicker onPick={pickBorough} loadSlim={loadSlim} reason={state} onRetry={locate} />
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

function BoroughPicker({
  onPick,
  loadSlim,
  reason,
  onRetry,
}: {
  onPick: (borough: string) => void;
  loadSlim: () => Promise<PricedPoint[]>;
  reason: "denied" | "unavailable" | "none";
  onRetry?: () => void;
}) {
  const [boroughs, setBoroughs] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void loadSlim().then((slim) => {
      if (alive) setBoroughs(boroughsWithPrices(slim));
    });
    return () => {
      alive = false;
    };
  }, [loadSlim]);

  const message =
    reason === "denied"
      ? "No problem. Location is off. Pick your area and we'll show the cheapest pints there."
      : reason === "none"
        ? "No priced pubs turned up nearby. Pick an area to see the cheapest pints there."
        : "Location isn't available here. Pick your area to see the cheapest pints there.";

  return (
    <div className="nmnFallback">
      <p className="nmnFallbackMsg">{message}</p>
      {onRetry ? (
        <button type="button" className="nmnRetry nmnRetryGhost" onClick={onRetry}>
          <LocateFixed size={15} aria-hidden="true" /> Try my location again
        </button>
      ) : null}
      <ul className="nmnBoroughs" aria-label="Pick a London area">
        {boroughs.map((name) => (
          <li key={name}>
            <button type="button" className="nmnBoroughChip" onClick={() => onPick(name)}>
              {name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
