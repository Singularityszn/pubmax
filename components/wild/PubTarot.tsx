"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/ui/empty-state";
import { NEAR_ME_LOCATION_OPTIONS } from "@/lib/nearMeLocation";
import { CENTRAL_PATCH } from "@/lib/nightPatches";
import { budgetCeiling, readBudgetChoice } from "@/lib/onboardingFlow";
import { PINT_ROULETTE_WALK_MINUTES, type RouletteRandom } from "@/lib/pintRoulette";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { loadSlimVenuesForCityResult } from "@/lib/venuesSlim";
import { drawPubTarot, pubTarotListings, type PubTarotDraw } from "@/lib/wildTarot";
import PubSign from "./PubSign";
import "./PubTarot.css";

type Origin = { lat: number; lng: number; fromReader: boolean };
type State =
  | { status: "idle" | "drawing" | "unavailable" }
  | { status: "empty"; origin: Origin; capped: boolean }
  | { status: "ready"; origin: Origin; capped: boolean; draw: PubTarotDraw };
const titles = ["Where you were", "Where you are", "Where you are going"];

export default function PubTarot({ cityId, random = Math.random }: { cityId: string; random?: RouletteRandom }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const titleId = useId();
  const lifetime = useRef({ active: false });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const session = lifetime.current;
    session.active = true;
    return () => { session.active = false; controller.current?.abort(); };
  }, []);

  const draw = () => {
    const session = lifetime.current;
    controller.current?.abort();
    const pending = new AbortController();
    controller.current = pending;
    const live = () => session.active && controller.current === pending && !pending.signal.aborted;
    setState({ status: "drawing" });
    const from = (origin: Origin) => {
      if (!live()) return;
      const budget = readBudgetChoice();
      const cap = budget ? budgetCeiling(budget) : null;
      // Only a deliberate draw reads the asset. Its fixed URL carries no position.
      const timeout = window.setTimeout(() => {
        if (live()) setState({ status: "unavailable" });
        pending.abort();
      }, 10_000);
      pending.signal.addEventListener("abort", () => window.clearTimeout(timeout), { once: true });
      const heritage = fetch("/data/heritage_listings.json", { signal: pending.signal }).then(async (response) => {
        if (!response.ok) throw new Error("Heritage read failed");
        const data: unknown = await response.json();
        pubTarotListings(data);
        return data;
      });
      void Promise.all([loadSlimVenuesForCityResult(cityId), heritage]).then(([venues, data]) => {
        if (!live()) return;
        if (venues.status !== "ready") throw new Error("Pub read failed");
        const result = drawPubTarot(origin.lat, origin.lng, venues.rows, data, { random, priceCapGbp: cap });
        setState(result ? { status: "ready", origin, capped: cap !== null, draw: result } : { status: "empty", origin, capped: cap !== null });
      }).catch(() => {
        if (session.active && controller.current === pending) setState({ status: "unavailable" });
      }).finally(() => window.clearTimeout(timeout));
    };
    const central: Origin = { lat: CENTRAL_PATCH.lat, lng: CENTRAL_PATCH.lng, fromReader: false };
    if (!navigator.geolocation) { from(central); return; }
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => from({ lat: coords.latitude, lng: coords.longitude, fromReader: true }),
        () => from(central), NEAR_ME_LOCATION_OPTIONS,
      );
    } catch { from(central); }
  };
  const resolved = state.status === "ready" || state.status === "empty" ? state : null;
  const announcement = state.status === "drawing" ? "Drawing three pubs…"
    : state.status === "ready" ? `Three pubs drawn at random from ${state.draw.poolSize} eligible pubs.`
    : state.status === "empty" ? "Fewer than three pubs match this draw."
    : state.status === "unavailable" ? "The pub list or heritage links could not load. Try the draw again." : "";

  return (
    <section className="pubTarot" aria-labelledby={titleId}>
      <h2 id={titleId}>Pub Tarot</h2>
      <p>Three real pubs at random, each with a linked heritage fact, within {PINT_ROULETTE_WALK_MINUTES} minutes&apos; walk.</p>
      <p>The card titles are playful. They do not describe your past or predict your future.</p>
      <Button type="button" variant="secondary" onClick={draw} disabled={state.status === "drawing"}>
        {state.status === "drawing" ? "Drawing three pubs…" : state.status === "idle" ? "Draw three pubs" : "Draw again"}
      </Button>
      <p role="status" className="pubTarotStatus">{announcement}</p>
      {resolved && !resolved.origin.fromReader ? <p>No location, so this draw is from {CENTRAL_PATCH.label}.</p> : null}
      {resolved?.capped ? <p>Your saved pint budget limits this draw.</p> : null}
      {state.status === "empty" ? <EmptyState title="Not enough linked pub stories for three cards.">Try another draw from a different spot or change your saved pint budget. The walk stays at 15 minutes.</EmptyState> : null}
      {state.status === "ready" ? <ol className="pubTarotCards">
        {state.draw.cards.map((card, index) => <li key={card.id}>
          <h3>{titles[index]}</h3>
          <div className="pubTarotCardBody">
            <div aria-hidden="true" className="pubTarotSign"><PubSign name={card.name} area={card.borough} variant="compact" /></div>
            <div className="pubTarotFact">
              <Link prefetch={false} href={venueMapUrl(card.id)} className="pubTarotName">{card.name}</Link>
              {card.borough ? <p>{card.borough}</p> : null}
              <p>{card.fact}</p>
              <a href={card.sourceUrl} target="_blank" rel="noopener noreferrer">Historic England listing for {card.name}</a>
              <p>{card.walkMinutes} min estimated walk{state.origin.fromReader ? "" : ` from ${CENTRAL_PATCH.label}`}</p>
            </div>
          </div>
        </li>)}
      </ol> : null}
      {state.status === "ready" ? <p>Listed-building data: Historic England, National Heritage List for England, © Historic England. <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener noreferrer">Open Government Licence v3.0</a>.</p> : null}
      <p className="pubTarotPrivacy">Your location stays on this device and only sets the walk. This draw does not save your location or pub choices.</p>
    </section>
  );
}
