"use client";

// THE PINT LINE (wild idea 02, docs/plans/DESIGN_UX_PLAN.md section 12).
//
// The crawl drawn as a line diagram in our own style: the pubs are stations in
// crawl order, each with its name and its listed pint in its band colour, the
// walk minutes ride the track, and a pint glass runs the line while it draws
// itself, stopping at every station like a train. No roundel, no transport
// colours, no line names: it is our line.
//
// Loaded on named routes through PintLineGate.tsx. The geometry is
// lib/wildPintLine.ts; this file paints it and runs the glass. The run mutates
// the SVG directly from one animation frame loop, so React renders once per
// layout and never per frame. With reduced motion the line is drawn whole and
// the glass waits at the end.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatPence } from "@/lib/formatGbp";
import { priceBandClass } from "@/lib/priceBand";
import { prefersReducedMotion } from "@/lib/wildMode";
import {
  PINT_LINE_GEOMETRY,
  PINT_LINE_TYPE,
  layoutPintLine,
  type MeasureText,
  type PintLineLayout,
  type PintLineStopInput,
} from "@/lib/wildPintLine";
import {
  crawlPriceListing,
  crawlRound,
  listedDaysText,
  missingStopsText,
  sourcesText,
  stopsText,
  toPence,
  unsourcedText,
  type WildCrawl,
} from "@/lib/wildPintLineCrawl";

import "./pintLine.css";

/** Measures with the page's own faces once they have loaded. */
function canvasMeasure(host: Element): MeasureText | null {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  const style = getComputedStyle(host);
  const faces = {
    display: style.getPropertyValue("--font-display").trim() || "sans-serif",
    body: style.getPropertyValue("--font-body").trim() || "sans-serif",
    data: style.getPropertyValue("--font-data").trim() || "monospace",
  };
  const cache = new Map<string, number>();
  return (text, font) => {
    const key = `${font}\u0000${text}`;
    const known = cache.get(key);
    if (known !== undefined) return known;
    const type = PINT_LINE_TYPE[font];
    context.font = `${type.weight} ${type.size}px ${faces[type.face]}`;
    const width = context.measureText(text).width;
    cache.set(key, width);
    return width;
  };
}

/** Waits for the faces, but never for long: a slow font still gets a line. */
function fontsSettled(): Promise<void> {
  const ready = typeof document !== "undefined" && document.fonts ? document.fonts.ready.then(() => undefined) : Promise.resolve();
  return Promise.race([ready, new Promise<void>((resolve) => window.setTimeout(resolve, 1200))]);
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

type Nodes = {
  section: HTMLElement;
  line: SVGPathElement;
  glass: SVGGElement;
  bob: SVGGElement;
  lit: SVGGElement[][];
  legs: SVGGElement[];
};

function readNodes(section: HTMLElement | null, count: number): Nodes | null {
  if (!section) return null;
  const line = section.querySelector<SVGPathElement>(".pintLine__line");
  const glass = section.querySelector<SVGGElement>(".pintLine__glass");
  const bob = section.querySelector<SVGGElement>(".pintLine__glassBob");
  if (!line || !glass || !bob) return null;
  const lit = Array.from({ length: count }, (_, i) =>
    Array.from(section.querySelectorAll<SVGGElement>(`.pintLine__stop[data-at="${i}"], .pintLine__label[data-at="${i}"]`)),
  );
  const legs = Array.from(section.querySelectorAll<SVGGElement>(".pintLine__leg"));
  return { section, line, glass, bob, lit, legs };
}

function showFinal(nodes: Nodes, layout: PintLineLayout): void {
  nodes.section.dataset.run = "done";
  nodes.line.style.strokeDasharray = "";
  nodes.line.style.strokeDashoffset = "";
  nodes.glass.setAttribute("transform", `translate(${layout.end[0]} ${layout.end[1]})`);
  nodes.bob.setAttribute("transform", "");
}

/** Runs the glass down the line. Returns the cancel. */
function play(nodes: Nodes, layout: PintLineLayout): () => void {
  const { section, line, glass, bob, lit, legs } = nodes;
  const total = line.getTotalLength();
  if (!(total > 0)) {
    showFinal(nodes, layout);
    return () => undefined;
  }
  // Sample the drawn path once, so a frame reads an array and never the DOM.
  const count = Math.max(2, Math.ceil(total / 2));
  const xs = new Float32Array(count + 1);
  const ys = new Float32Array(count + 1);
  for (let k = 0; k <= count; k++) {
    const point = line.getPointAtLength((total * k) / count);
    xs[k] = point.x;
    ys[k] = point.y;
  }
  const arcAt = (x: number, y: number) => {
    let best = 0;
    let bestDistance = Infinity;
    for (let k = 0; k <= count; k++) {
      const distance = (xs[k]! - x) ** 2 + (ys[k]! - y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = k;
      }
    }
    return (total * best) / count;
  };
  const stationAt = layout.stations.map((station) => arcAt(station.x, station.y));
  const legAt = layout.legs.map((leg) => arcAt(leg.x, leg.y));

  type Segment = { from: number; to: number; ms: number; dwell: boolean };
  const travel = 1300 + 260 * layout.stations.length;
  const segments: Segment[] = [];
  let previous = 0;
  for (const at of stationAt) {
    segments.push({ from: previous, to: at, ms: Math.max(220, (travel * (at - previous)) / total), dwell: false });
    segments.push({ from: at, to: at, ms: 200, dwell: true });
    previous = at;
  }
  segments.push({ from: previous, to: total, ms: Math.max(260, (travel * (total - previous)) / total), dwell: false });

  section.dataset.run = "running";
  for (const group of lit) for (const node of group) node.classList.remove("isLit");
  for (const node of legs) node.classList.remove("isLit");
  line.style.strokeDasharray = `${total} ${total}`;
  line.style.strokeDashoffset = `${total}`;

  let nextStation = 0;
  let nextLeg = 0;
  let frame = 0;
  const started = performance.now();
  const tick = (now: number) => {
    let elapsed = now - started;
    let at = total;
    let hop = 0;
    let tilt = 0;
    let finished = true;
    for (const segment of segments) {
      if (elapsed < segment.ms) {
        const progress = elapsed / segment.ms;
        finished = false;
        if (segment.dwell) {
          at = segment.from;
          hop = -8 * Math.sin(Math.PI * progress);
        } else {
          at = segment.from + (segment.to - segment.from) * easeInOut(progress);
          // Lean back pulling away, forward braking in: the slosh of a full pint.
          tilt = -7 * Math.sin(2 * Math.PI * progress);
        }
        break;
      }
      elapsed -= segment.ms;
    }
    const k = Math.min(count, Math.max(0, Math.round((at / total) * count)));
    line.style.strokeDashoffset = `${total - at}`;
    glass.setAttribute("transform", `translate(${xs[k]!.toFixed(1)} ${ys[k]!.toFixed(1)})`);
    bob.setAttribute("transform", `translate(0 ${hop.toFixed(2)}) rotate(${tilt.toFixed(2)} 0 12)`);
    while (nextStation < stationAt.length && stationAt[nextStation]! <= at + 0.5) {
      for (const node of lit[nextStation] ?? []) node.classList.add("isLit");
      nextStation += 1;
    }
    while (nextLeg < legAt.length && legAt[nextLeg]! <= at + 0.5) {
      legs[nextLeg]?.classList.add("isLit");
      nextLeg += 1;
    }
    if (finished) {
      showFinal(nodes, layout);
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

function Glass() {
  return (
    <>
      <path
        className="pintLine__glassBeer"
        d="M-9.3 -8 L9.3 -8 Q8.6 -3 8 -1 L6.8 13 Q6.6 14.5 5 14.5 L-5 14.5 Q-6.6 14.5 -6.8 13 L-8 -1 Q-8.6 -3 -9.3 -8 Z"
      />
      <path
        className="pintLine__glassFoam"
        d="M-10.4 -8 C-12 -12 -9 -17 -5 -15.4 C-3 -19 3 -19 4.6 -15.4 C8.6 -17 12 -12.4 10.4 -8 Z"
      />
      <path
        className="pintLine__glassEdge"
        d="M-10 -14 L10 -14 L9.2 -6 Q8.6 -3 8 -1 L6.8 13 Q6.6 14.5 5 14.5 L-5 14.5 Q-6.6 14.5 -6.8 13 L-8 -1 Q-8.6 -3 -9.2 -6 Z"
      />
      <path className="pintLine__glassShine" d="M-5 -4 L-3.6 10" />
    </>
  );
}

export default function PintLine({ crawl }: { crawl: WildCrawl }) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const drawingId = `${uid}-drawing`;
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [measure, setMeasure] = useState<MeasureText | null>(null);
  const [run, setRun] = useState(0);
  const played = useRef(-1);

  // The width to draw in, kept to whole pixels so a scrollbar's flicker does
  // not lay the line out twice.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const read = () => setWidth(Math.round(stage.getBoundingClientRect().width));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Lay out with the real faces: a label wrapped for the fallback face would
  // be wrapped wrong once the page's own face arrives.
  useEffect(() => {
    let alive = true;
    void fontsSettled().then(() => {
      if (!alive || !stageRef.current) return;
      const real = canvasMeasure(stageRef.current);
      setMeasure(() => real ?? ((text: string, font) => text.length * PINT_LINE_TYPE[font].size * 0.62));
    });
    return () => {
      alive = false;
    };
  }, []);

  const inputs = useMemo<PintLineStopInput[]>(
    () =>
      crawl.stops.map((stop) => ({
        point: stop.point,
        name: stop.name,
        price: stop.pint ? formatPence(toPence(stop.pint.priceGbp)) : null,
        drink: stop.pint?.drink ?? null,
        missingText: "No price listed",
        leg: stop.legMinutes !== null ? `~${stop.legMinutes} min` : null,
      })),
    [crawl.stops],
  );

  const layout = useMemo(
    () => (width > 0 && measure ? layoutPintLine(inputs, { width, measure }) : null),
    [inputs, width, measure],
  );
  const layoutKey = layout ? `${layout.width}x${layout.height}:${layout.path}` : "";

  // A new run plays once; a new layout (a turned phone, a wider window) shows
  // the finished line rather than running it again.
  useLayoutEffect(() => {
    if (!layout) return;
    const nodes = readNodes(sectionRef.current, layout.stations.length);
    if (!nodes) return;
    if (played.current === run || prefersReducedMotion()) {
      played.current = run;
      showFinal(nodes, layout);
      return;
    }
    played.current = run;
    return play(nodes, layout);
    // layoutKey stands for the layout: a new object with the same geometry is not a new line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, run]);

  const replay = useCallback(() => setRun((value) => value + 1), []);
  const [shared, setShared] = useState<string | null>(null);

  const stops = crawl.stops;
  // Counted against the stops the crawl plans, so a stop the dataset has lost
  // keeps "every stop" off the poster.
  const round = crawlRound(stops, 1, crawl.plannedStops);
  const listedUnpriced = round.unpricedStops - round.missingStops;
  const listing = crawlPriceListing(stops);
  const listedDays = listedDaysText(listing);
  const listedBy = sourcesText(listing.sources);
  const first = stops[0]?.name;
  const last = stops[stops.length - 1]?.name;
  const drawingTitle =
    stops.length > 1 && first && last
      ? `${crawl.name} as a line: ${stopsText(stops.length)}, from ${first} to ${last}.`
      : `${crawl.name} as a line.`;
  const g = PINT_LINE_GEOMETRY;

  // Shares the page and one line of what is on it: the same figures the poster
  // prints, with the day they were listed. The wild switch stays this
  // browser's own, so it is taken off the link.
  const share = async () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("wild");
    const parts = [`${crawl.name}: ${stopsText(stops.length)}`];
    if (crawl.totalMinutes !== null) parts.push(`about ${crawl.totalMinutes} min on foot`);
    if (round.pricedStops > 0) {
      parts.push(
        `${formatPence(round.pintEachStopPence)} subtotal for a pint at ${round.unpricedStops > 0 ? "each priced" : "every"} stop${
          listedDays ? ` (prices listed ${listedDays})` : ""
        }`,
      );
    }
    const text = `${parts.join(", ")}.`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: crawl.name, text, url: url.toString() });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url.toString()}`);
      setShared("Link copied.");
    } catch {
      // A share sheet closed without sharing is not an error to show.
    }
  };

  return (
    <section ref={sectionRef} className="pintLine" aria-labelledby={titleId}>
      <header className="pintLine__head">
        <p className="pintLine__kicker">
          <span className="pintLine__kickerMark" aria-hidden="true" />
          The Pint Line
        </p>
        <h2 className="pintLine__title" id={titleId}>
          {crawl.name}
        </h2>
        <div className="pintLine__totals">
          <p className="pintLine__stat">
            <span className="pintLine__statFigure">{stops.length}</span>
            <span className="pintLine__statWord">{stops.length === 1 ? "stop" : "stops"}</span>
          </p>
          {crawl.totalMinutes !== null ? (
            <p className="pintLine__stat">
              <span className="pintLine__statFigure">{crawl.totalMinutes} min</span>
              <span className="pintLine__statWord">on foot, about</span>
            </p>
          ) : null}
          {round.pricedStops > 0 ? (
            <p className="pintLine__stat">
              <span className="pintLine__statFigure">{formatPence(round.pintEachStopPence)}</span>
              <span className="pintLine__statWord">
                Selected pints subtotal: {" "}
                {round.unpricedStops > 0
                  ? `a pint at the ${round.pricedStops} priced ${round.pricedStops === 1 ? "stop" : "stops"}`
                  : "a pint at every stop"}
              </span>
            </p>
          ) : null}
        </div>
      </header>

      <div className="pintLine__stage" ref={stageRef}>
        {layout ? (
          <svg
            className="pintLine__svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width={layout.width}
            height={layout.height}
            role="img"
            aria-labelledby={drawingId}
            data-orientation={layout.orientation}
          >
            <title id={drawingId}>{drawingTitle}</title>
            <path className="pintLine__track" d={layout.path} strokeWidth={g.lineWidth} />
            <path className="pintLine__line" d={layout.path} strokeWidth={g.lineWidth} />
            {layout.legs.map((leg) => (
              <g className="pintLine__leg" data-at={leg.index} key={`leg-${leg.index}`}>
                <rect
                  className="pintLine__legTag"
                  x={leg.x - leg.w / 2}
                  y={leg.y - leg.h / 2}
                  width={leg.w}
                  height={leg.h}
                  rx={leg.h / 2}
                />
                <text
                  className="pintLine__legTime"
                  x={leg.x}
                  y={leg.y + 3.8}
                  textAnchor="middle"
                  fontSize={PINT_LINE_TYPE.leg.size}
                  fontWeight={PINT_LINE_TYPE.leg.weight}
                >
                  {leg.text}
                </text>
              </g>
            ))}
            {layout.stations.map((station, i) => (
              <g className="pintLine__stop" data-at={i} key={`stop-${i}`}>
                <circle
                  className="pintLine__station"
                  cx={station.x}
                  cy={station.y}
                  r={g.stationRadius}
                  strokeWidth={g.stationStroke}
                />
                <text
                  className="pintLine__stationNum"
                  x={station.x}
                  y={station.y + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                >
                  {stops[i]?.position ?? i + 1}
                </text>
              </g>
            ))}
            {layout.labels.map((label) => {
              const band = stops[label.index]?.pint?.band ?? null;
              return (
                <g className="pintLine__label" data-at={label.index} data-side={label.side} key={`label-${label.index}`}>
                  {label.lines.map((line, k) =>
                    line.kind === "name" ? (
                      <text
                        key={k}
                        className="pintLine__name"
                        x={label.x}
                        y={line.y}
                        textAnchor={label.anchor}
                        fontSize={PINT_LINE_TYPE.name.size}
                        fontWeight={PINT_LINE_TYPE.name.weight}
                      >
                        {line.text}
                      </text>
                    ) : (
                      <text key={k} className="pintLine__detail" x={label.x} y={line.y} textAnchor={label.anchor}>
                        {line.price ? (
                          <tspan
                            className={`pintLine__price ${priceBandClass(band)}`}
                            fontSize={PINT_LINE_TYPE.price.size}
                            fontWeight={PINT_LINE_TYPE.price.weight}
                          >
                            {line.price}
                          </tspan>
                        ) : null}
                        {line.text ? (
                          <tspan
                            className={line.missing ? "pintLine__missing" : "pintLine__drink"}
                            fontSize={PINT_LINE_TYPE.drink.size}
                            fontWeight={PINT_LINE_TYPE.drink.weight}
                          >
                            {line.price ? ` ${line.text}` : line.text}
                          </tspan>
                        ) : null}
                      </text>
                    ),
                  )}
                </g>
              );
            })}
            <g className="pintLine__glass" transform={`translate(${layout.end[0]} ${layout.end[1]})`} aria-hidden="true">
              <g className="pintLine__glassBob">
                <Glass />
              </g>
            </g>
          </svg>
        ) : (
          <div className="pintLine__waiting" aria-hidden="true" />
        )}
      </div>

      <p className="pintLine__note">
        {round.pricedStops > 0 ? (
          <>
            Pints listed{listedBy ? ` by ${listedBy}` : ""}
            {listedDays ? (
              <>, read {listedDays}</>
            ) : null}
            .{" "}
          </>
        ) : null}
        {listedUnpriced > 0
          ? `${listedUnpriced} ${listedUnpriced === 1 ? "stop has" : "stops have"} no listed price. `
          : null}
        {round.missingStops > 0 ? `${missingStopsText(round.missingStops)} ` : null}
        {listing.unsourced > 0 ? `${unsourcedText(listing.unsourced)} ` : null}
        {crawl.totalMinutes !== null
          ? "Walk times are straight-line estimates, so allow for the streets."
          : "We cannot place every stop, so there is no walking total."}
      </p>

      <div className="pintLine__actions">
        <Button type="button" variant="ghost" onClick={replay}>
          Run the line again
        </Button>
        <Button type="button" variant="secondary" onClick={() => void share()}>
          Share the line
        </Button>
        <p className="pintLine__shared" role="status">
          {shared}
        </p>
      </div>
    </section>
  );
}

