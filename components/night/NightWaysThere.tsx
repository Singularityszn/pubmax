"use client";

import { Bus, Footprints, TrainFront } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import {
  formatLegFare,
  legOptionName,
  type LegOption,
  type LegOptionsResponse,
} from "@/lib/legOptions";
import {
  readLegRouteOnMap,
  showLegRouteOnMap,
  subscribeLegRouteOnMap,
} from "@/lib/legRouteOnMap";
import "./nightWaysThere.css";

// "Ways to get there": the walk, the tube and the bus from this stop to the
// next, each with its time, TfL's fare (or "Fare not listed") and the fastest
// and the cheapest marked (lib/legOptions.ts, GET /api/leg-options). It asks
// TfL only when the reader opens it, and a tap on an option draws that exact
// route on the map (lib/legRouteOnMap.ts). Both ends are pubs on the plan, so
// no location leaves the device.

type Point = { lat: number; lng: number };

type Ask =
  | { state: "closed" }
  | { state: "loading" }
  | { state: "ready"; options: LegOption[] }
  | { state: "none" }
  | { state: "failed" };

function legQuery(from: Point, to: Point): string {
  return `from=${from.lat.toFixed(5)},${from.lng.toFixed(5)}&to=${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
}

function OptionIcon({ option }: { option: LegOption }) {
  if (option.kind === "walk") return <Footprints size={20} aria-hidden="true" />;
  if (option.parts.some((part) => part.mode === "bus") && !option.parts.some((part) => part.mode !== "bus" && part.mode !== "walking")) {
    return <Bus size={20} aria-hidden="true" />;
  }
  return <TrainFront size={20} aria-hidden="true" />;
}

export default function NightWaysThere({ legKey, from, to }: { legKey: string; from: Point; to: Point }) {
  const [ask, setAsk] = useState<Ask>({ state: "closed" });
  const [attempt, setAttempt] = useState(0);
  const onMap = useSyncExternalStore(subscribeLegRouteOnMap, readLegRouteOnMap, () => null);
  const router = useRouter();
  const pathname = usePathname();
  const query = legQuery(from, to);
  const open = ask.state !== "closed";

  // A new leg (the night moved on) starts closed, and its old route leaves the map.
  useEffect(() => {
    queueMicrotask(() => setAsk({ state: "closed" }));
    const shown = readLegRouteOnMap();
    if (shown && shown.legKey !== legKey) showLegRouteOnMap(null);
  }, [legKey]);

  useEffect(() => {
    if (!open || attempt === 0) return;
    const controller = new AbortController();
    queueMicrotask(() => setAsk({ state: "loading" }));
    fetch(`/api/leg-options?${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<LegOptionsResponse>) : null))
      .then((body) => {
        if (controller.signal.aborted) return;
        if (!body) setAsk({ state: "failed" });
        else if (body.status !== "ok" || body.options.length === 0) setAsk({ state: "none" });
        else setAsk({ state: "ready", options: body.options });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAsk({ state: "failed" });
      });
    return () => controller.abort();
    // `open` turns on with the first attempt; a retry bumps `attempt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, query]);

  const toggle = () => {
    if (open) {
      setAsk({ state: "closed" });
      return;
    }
    setAsk({ state: "loading" });
    setAttempt((count) => count + 1);
  };

  const choose = (option: LegOption) => {
    const shown = onMap?.legKey === legKey && onMap.option.id === option.id;
    showLegRouteOnMap(shown ? null : { legKey, option });
    if (!shown && pathname !== "/map") router.push("/map");
  };

  return (
    <div className="nightWays" data-testid="night-ways-there">
      <button type="button" className="nightWays__toggle" aria-expanded={open} onClick={toggle}>
        Ways to get there
      </button>
      {ask.state === "loading" ? <p className="nightWays__note" role="status">Asking TfL…</p> : null}
      {ask.state === "none" ? (
        <p className="nightWays__note" role="status">TfL has no way to show for this leg right now.</p>
      ) : null}
      {ask.state === "failed" ? (
        <p className="nightWays__note" role="status">
          TfL didn&apos;t answer.{" "}
          <button type="button" className="nightWays__retry" onClick={() => setAttempt((count) => count + 1)}>
            Ask again
          </button>
        </p>
      ) : null}
      {ask.state === "ready" ? (
        <ul className="nightWays__list" aria-label="Ways to get to the next stop">
          {ask.options.map((option) => {
            const shown = onMap?.legKey === legKey && onMap.option.id === option.id;
            const name = legOptionName(option);
            const fare = formatLegFare(option.farePence);
            const marks = [option.fastest ? "Fastest" : null, option.cheapest ? "Cheapest" : null].filter(Boolean);
            return (
              <li key={option.id}>
                <button
                  type="button"
                  className="nightWays__option"
                  aria-pressed={shown}
                  aria-label={`${name}, ${option.estimate ? "about " : ""}${option.minutes} min, ${fare}${
                    marks.length ? `, ${marks.join(" and ").toLowerCase()}` : ""
                  }${shown ? ", on the map" : ", show on the map"}`}
                  onClick={() => choose(option)}
                >
                  <OptionIcon option={option} />
                  <span className="nightWays__name">
                    {name}
                    {option.estimate ? <small>Straight-line estimate</small> : null}
                  </span>
                  <span className="nightWays__time">
                    {option.estimate ? "~" : ""}
                    {option.minutes} min
                  </span>
                  <span className="nightWays__fare">{fare}</span>
                  {marks.length ? (
                    <span className="nightWays__marks">
                      {option.fastest ? <span className="nightWays__mark">Fastest</span> : null}
                      {option.cheapest ? <span className="nightWays__mark nightWays__mark--cheap">Cheapest</span> : null}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {ask.state === "ready" ? <p className="nightWays__source">Times and fares from TfL, if you leave now.</p> : null}
    </div>
  );
}
