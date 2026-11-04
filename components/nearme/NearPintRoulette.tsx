"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Dices, Footprints, MapPin, RotateCw } from "lucide-react";

import PriceBadge from "@/components/PriceBadge";
import SharePintButton from "@/components/share/SharePintButton";
import { Button } from "@/components/ui/button";
import { formatGbp } from "@/lib/formatGbp";
import { NEAR_ME_LOCATION_OPTIONS } from "@/lib/nearMeLocation";
import { nearPriceTrustLabel } from "@/lib/nearPriceTrust";
import { CENTRAL_PATCH } from "@/lib/nightPatches";
import { budgetCeiling, readBudgetChoice } from "@/lib/onboardingFlow";
import { pintShareFrom } from "@/lib/pintShare";
import {
  PINT_ROULETTE_WALK_MINUTES,
  spinPintRoulette,
  type PintRouletteFact,
  type PintRoulettePick,
  type PintRoulettePoint,
  type RouletteRandom,
} from "@/lib/pintRoulette";
import { priceBand, priceBandAreaForVenue } from "@/lib/priceBand";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { loadSlimVenuesForCityResult } from "@/lib/venuesSlim";

import "./nearPlayful.css";

/** Where the wheel spins from: the reader, or central London when they said no. */
type RouletteOrigin = { lat: number; lng: number; fromReader: boolean };

type RouletteState =
  | { status: "idle" }
  | { status: "spinning" }
  | { status: "ready"; pick: PintRoulettePick; origin: RouletteOrigin; cap: number | null }
  | { status: "empty"; origin: RouletteOrigin; cap: number | null }
  | { status: "unavailable" };

/** The reader's fair pint from first-run setup, or null when they set none. */
function readFairPint(): number | null {
  const choice = readBudgetChoice();
  return choice ? budgetCeiling(choice) : null;
}

function capPhrase(cap: number | null): string {
  return cap === null ? "" : ` at ${formatGbp(cap)} or less`;
}

/** The card's honest framing: random, from how many, within what. */
export function pintRoulettePoolLine(pick: PintRoulettePick, cap: number | null): string {
  const pubs = pick.poolSize === 1 ? "the only pub" : `one of ${pick.poolSize} pubs`;
  return `Picked at random from ${pubs} with a listed pint${capPhrase(cap)} within ${PINT_ROULETTE_WALK_MINUTES} minutes' walk.`;
}

export function pintRouletteEmptyLine(cap: number | null, fromReader: boolean): string {
  const where = fromReader ? "of you" : `of ${CENTRAL_PATCH.label}`;
  return `The wheel came up empty. No pub with a listed pint${capPhrase(cap)} within ${PINT_ROULETTE_WALK_MINUTES} minutes' walk ${where}.`;
}

/** The pick as a card. Exported for the render test. */
export function PintRouletteCard({
  pick,
  origin,
  cap,
  onSpinAgain,
}: {
  pick: PintRoulettePick;
  origin: RouletteOrigin;
  cap: number | null;
  onSpinAgain: () => void;
}) {
  const share = pintShareFrom({
    venueId: pick.id,
    name: pick.name,
    area: pick.borough,
    priceGbp: pick.priceGbp,
    publisher: pick.publisher,
    observedAt: pick.observedAt,
  });
  return (
    <div className="nmnRouletteCard" data-testid="near-roulette-pick">
      <p className="nmnRouletteKicker">{pintRoulettePoolLine(pick, cap)}</p>
      <p className="nmnRouletteName">
        <Link prefetch={false} href={venueMapUrl(pick.id)}>{pick.name}</Link>
      </p>
      <p className="nmnRoulettePrice">
        <PriceBadge band={priceBand(pick.priceGbp, priceBandAreaForVenue(pick.id))}>
          {formatGbp(pick.priceGbp)}
        </PriceBadge>
        <span className="nmnRouletteSource">
          {nearPriceTrustLabel("named", pick.publisher, pick.observedAt)}
        </span>
      </p>
      <p className="nmnRouletteWalk">
        <Footprints size={14} aria-hidden="true" />
        {origin.fromReader
          ? `${pick.walkMinutes} min walk`
          : `${pick.walkMinutes} min walk from ${CENTRAL_PATCH.label}`}
        {pick.borough ? ` · ${pick.borough}` : null}
      </p>
      {pick.factLine ? <p className="nmnRouletteFact">{pick.factLine}</p> : null}
      <div className="nmnRouletteActions">
        {pick.poolSize > 1 ? (
          <Button type="button" variant="secondary" onClick={onSpinAgain}>
            <RotateCw size={16} aria-hidden="true" /> Spin again
          </Button>
        ) : null}
        <Link prefetch={false} className="nmnRouletteMap" href={venueMapUrl(pick.id)}>
          <MapPin size={16} aria-hidden="true" /> Open on the map
        </Link>
        {share ? <SharePintButton share={share} /> : null}
      </div>
    </div>
  );
}

/**
 * Pint roulette (launch review D2). One quiet button: it asks for a location
 * only when tapped, spins from central London when the answer is no, and never
 * sends the position anywhere: the walk is worked out on this page.
 */
export default function NearPintRoulette({
  facts,
  cityId,
  random = Math.random,
}: {
  facts: readonly PintRouletteFact[];
  cityId: string;
  random?: RouletteRandom;
}) {
  const [state, setState] = useState<RouletteState>({ status: "idle" });
  const venuesRef = useRef<PintRoulettePoint[] | null>(null);
  // A spin answers only while this card is mounted, and only for the latest
  // tap, so a slow location or index read never lands on a later spin.
  const mountedRef = useRef(false);
  const spinRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const spin = useCallback(
    (venues: readonly PintRoulettePoint[], origin: RouletteOrigin, excludeId: string | null) => {
      const cap = readFairPint();
      const pick = spinPintRoulette(origin.lat, origin.lng, venues, facts, {
        random,
        priceCapGbp: cap,
        excludeId,
      });
      setState(pick ? { status: "ready", pick, origin, cap } : { status: "empty", origin, cap });
    },
    [facts, random],
  );

  const loadVenues = useCallback(async (): Promise<PintRoulettePoint[] | null> => {
    if (venuesRef.current) return venuesRef.current;
    try {
      // A read we could not run is not an empty wheel: it is said as such.
      const read = await loadSlimVenuesForCityResult(cityId);
      if (read.status !== "ready") return null;
      venuesRef.current = read.rows;
      return venuesRef.current;
    } catch {
      return null;
    }
  }, [cityId]);

  const spinFrom = useCallback(
    (origin: RouletteOrigin, tap: number) => {
      void loadVenues().then((venues) => {
        if (!mountedRef.current || tap !== spinRef.current) return;
        if (!venues) {
          setState({ status: "unavailable" });
          return;
        }
        spin(venues, origin, null);
      });
    },
    [loadVenues, spin],
  );

  const surpriseMe = useCallback(() => {
    const tap = ++spinRef.current;
    setState({ status: "spinning" });
    const central: RouletteOrigin = { lat: CENTRAL_PATCH.lat, lng: CENTRAL_PATCH.lng, fromReader: false };
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      spinFrom(central, tap);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => spinFrom({ lat: position.coords.latitude, lng: position.coords.longitude, fromReader: true }, tap),
      () => spinFrom(central, tap),
      NEAR_ME_LOCATION_OPTIONS,
    );
  }, [spinFrom]);

  const spinAgain = useCallback(() => {
    if (state.status !== "ready" || !venuesRef.current) return;
    spin(venuesRef.current, state.origin, state.pick.id);
  }, [spin, state]);

  return (
    <section className="nmnRoulette" aria-labelledby="near-roulette-title">
      <h2 id="near-roulette-title" className="nmnPlayfulTitle">Pint roulette</h2>
      <p className="nmnRouletteLede">
        Can&apos;t decide? One pub at random with a listed pint, within {PINT_ROULETTE_WALK_MINUTES} minutes&apos; walk.
      </p>
      {state.status === "idle" || state.status === "unavailable" || state.status === "empty" ? (
        <Button type="button" variant="secondary" onClick={surpriseMe}>
          <Dices size={16} aria-hidden="true" /> Surprise me
        </Button>
      ) : null}
      <div aria-live="polite">
        {state.status === "spinning" ? <p className="nmnRouletteStatus" role="status">Spinning the wheel…</p> : null}
        {state.status === "unavailable" ? (
          <p className="nmnRouletteStatus">We could not read the pub list just now.</p>
        ) : null}
        {state.status === "empty" ? (
          <p className="nmnRouletteStatus">{pintRouletteEmptyLine(state.cap, state.origin.fromReader)}</p>
        ) : null}
        {state.status === "ready" ? (
          <>
            {state.origin.fromReader ? null : (
              <p className="nmnRouletteStatus">No location, so this spin is from {CENTRAL_PATCH.label}.</p>
            )}
            <PintRouletteCard pick={state.pick} origin={state.origin} cap={state.cap} onSpinAgain={spinAgain} />
          </>
        ) : null}
      </div>
      <p className="nmnHint">Your location stays on this device and only sets the walk.</p>
    </section>
  );
}
