"use client";

import Link from "next/link";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Chip } from "@/components/ui/chip";
import { formatGbp } from "@/lib/formatGbp";
import { priceBand, priceBandThresholdsFor, type PriceBand } from "@/lib/priceBand";
import { prefersReducedMotion } from "@/lib/wildMode";
import type { PriceGlassText, WildPriceGlass } from "@/lib/wildPriceGlass";

import {
  bubbleY,
  easeOutCubic,
  FOAM_DRAINED,
  FOAM_POURING,
  FOAM_SETTLED,
  foamPathD,
  foamStep,
  GLASS_BASE_PATH,
  GLASS_FLOOR_Y,
  GLASS_INNER_PATH,
  GLASS_VIEW_H,
  GLASS_VIEW_W,
  glassLevelShare,
  glassLevelY,
  makeBubbles,
  pourDurationMs,
  sloshAmplitude,
  sloshTilt,
} from "./priceGlassMotion";
import "./priceGlass.css";

// THE PRICE GLASS (round-two wild idea 01; it renders only while the wild
// switch is on, lib/wildMode.ts, and loads as its own chunk). The front door's
// hero pours a pint whose fill level is a price on a £0 to £10 scale, and the
// chips choose which price: London's average, its cheapest listed pint, three
// boroughs' medians and its dearest. lib/wildPriceGlass.ts decides those, at
// prerender, from the readers the landing already reads.
//
// THE FIGURE IS THE CLAIM, AND IT WEARS ITS BAND. The count-up figure takes the
// band class (lib/priceBand.ts) of the price it is showing, so it reads green,
// then amber, then red as it climbs, and lands on the real price. The band
// edges on the glass's side are London's own terciles, read from the same
// module. Under the figure, one line says what it is and one says who listed
// it or when the prices behind it were read. The beer is beer: its colour
// carries no band.
//
// MOTION. The pour, the rocking surface, the head of foam that settles and
// the rising bubbles are drawn by one animation frame loop writing SVG
// attributes, never React state, and the loop sleeps while the glass is off
// screen or the tab is hidden. Reduced motion shows the final glass and the
// final figure at once, with no stream, no rock and no fizz.

const AREA = { city: "london" } as const;
const BUBBLES = makeBubbles(16);
const CHIP_GROUPS = [
  { id: "london", name: "London" },
  { id: "borough", name: "Borough medians" },
] as const;

type Nodes = {
  svg: SVGSVGElement;
  beer: SVGRectElement;
  foam: SVGPathElement;
  stream: SVGRectElement;
  pointer: SVGGElement;
  bubbles: SVGCircleElement[];
  figure: HTMLSpanElement;
};

type Engine = {
  pour: (toGbp: number, options?: { fromEmpty?: boolean }) => void;
  destroy: () => void;
};

type Anim = { from: number; to: number; start: number; dur: number; then?: number };

function scaleLabel(priceGbp: number): string {
  return Number.isInteger(priceGbp) ? `£${priceGbp}` : formatGbp(priceGbp);
}

function createEngine(nodes: Nodes, scaleMaxGbp: number, reduced: boolean, observe: Element): Engine {
  let level = 0;
  let anim: Anim | null = null;
  let slosh = { amp: 0, start: 0 };
  let foamH = FOAM_SETTLED;
  let stream = 0;
  let raf = 0;
  let last = 0;
  let visible = true;
  let shownText = "";
  let shownBand: PriceBand | null | undefined;

  const paint = (now: number) => {
    const surface = glassLevelY(level, scaleMaxGbp);
    const tilt = reduced ? 0 : sloshTilt(slosh.amp, now - slosh.start);
    const room = Math.max(0, GLASS_FLOOR_Y - surface);
    const head = Math.min(foamH, room * 0.5);
    nodes.foam.setAttribute("d", foamPathD(surface, head, tilt, reduced ? 0 : now / 900));
    const beerTop = surface + head - Math.abs(tilt) - 1;
    nodes.beer.setAttribute("transform", `translate(0 ${beerTop.toFixed(2)})`);
    nodes.pointer.setAttribute("transform", `translate(0 ${surface.toFixed(2)})`);
    nodes.stream.setAttribute("height", Math.max(0, surface - head * 0.5).toFixed(2));
    nodes.stream.setAttribute("opacity", stream.toFixed(3));
    const fizzTop = surface + head + 3;
    BUBBLES.forEach((bubble, index) => {
      const node = nodes.bubbles[index];
      if (!node) return;
      const y = reduced ? null : bubbleY(bubble, now, fizzTop);
      if (y === null) {
        node.setAttribute("opacity", "0");
        return;
      }
      const x = bubble.x + Math.sin(now / 380 + bubble.sway) * 1.6;
      node.setAttribute("opacity", "0.75");
      node.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
    });
    const text = formatGbp(level);
    if (text !== shownText) {
      nodes.figure.textContent = text;
      shownText = text;
    }
    const band = priceBand(level, AREA);
    if (band !== shownBand) {
      nodes.figure.className = band ? `wildGlassFigure priceBand-${band}` : "wildGlassFigure";
      shownBand = band;
    }
  };

  const begin = (to: number, now: number) => {
    const from = level;
    anim = { from, to, start: now, dur: pourDurationMs(from, to, scaleMaxGbp) };
    slosh = { amp: sloshAmplitude(from, to, scaleMaxGbp), start: now };
  };

  const frame = (now: number) => {
    raf = 0;
    const dt = last ? Math.min(64, now - last) : 16;
    last = now;
    let pouring = false;
    let rising = false;
    if (anim) {
      const t = (now - anim.start) / anim.dur;
      level = anim.from + (anim.to - anim.from) * easeOutCubic(t);
      pouring = true;
      rising = anim.to > anim.from;
      if (t >= 1) {
        level = anim.to;
        const next = anim.then;
        anim = null;
        if (next !== undefined) begin(next, now);
      }
    }
    const foamTarget = pouring ? (rising ? FOAM_POURING : FOAM_DRAINED) : FOAM_SETTLED;
    foamH = foamStep(foamH, foamTarget, dt, pouring ? 180 : 650);
    stream = foamStep(stream, pouring && rising ? 1 : 0, dt, 90);
    paint(now);
    schedule();
  };

  const schedule = () => {
    if (reduced || !visible || raf) return;
    raf = requestAnimationFrame(frame);
  };

  const halt = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  };

  const wobble = () => {
    if (reduced || typeof nodes.svg.animate !== "function") return;
    nodes.svg.animate(
      [
        { transform: "rotate(0deg)" },
        { transform: "rotate(-2.2deg)" },
        { transform: "rotate(1.4deg)" },
        { transform: "rotate(-0.6deg)" },
        { transform: "rotate(0deg)" },
      ],
      { duration: 760, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  };

  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          visible = entries.some((entry) => entry.isIntersecting);
          if (visible && document.visibilityState === "visible") schedule();
          else halt();
        })
      : null;
  observer?.observe(observe);
  const onVisibility = () => {
    if (document.visibilityState === "visible") schedule();
    else halt();
  };
  document.addEventListener("visibilitychange", onVisibility);

  paint(0);

  return {
    pour(to, options) {
      if (reduced) {
        level = to;
        foamH = FOAM_SETTLED;
        stream = 0;
        paint(0);
        return;
      }
      const now = performance.now();
      if (options?.fromEmpty && level > 0.01) {
        anim = { from: level, to: 0, start: now, dur: 420, then: to };
        slosh = { amp: 9, start: now };
      } else {
        begin(to, now);
      }
      wobble();
      schedule();
    },
    destroy() {
      halt();
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

function TextLine({ parts, className }: { parts: PriceGlassText[]; className: string }) {
  return (
    <p className={className}>
      {parts.map((part, index) =>
        part.href ? (
          <Link key={index} prefetch={false} href={part.href}>
            {part.text}
          </Link>
        ) : part.url ? (
          <a key={index} href={part.url} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

export default function PriceGlass({ glass }: { glass: WildPriceGlass }) {
  const { pours, scaleMaxGbp } = glass;
  const [selectedId, setSelectedId] = useState(pours[0]?.id ?? "");
  const selected = pours.find((pour) => pour.id === selectedId) ?? pours[0];
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = { clip: `${uid}-clip`, beer: `${uid}-beer`, body: `${uid}-body` };

  const rootRef = useRef<HTMLElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const beerRef = useRef<SVGRectElement>(null);
  const foamRef = useRef<SVGPathElement>(null);
  const streamRef = useRef<SVGRectElement>(null);
  const pointerRef = useRef<SVGGElement>(null);
  const bubblesRef = useRef<SVGGElement>(null);
  const figureRef = useRef<HTMLSpanElement>(null);
  const engineRef = useRef<Engine | null>(null);

  const { cheapMaxGbp, averageMaxGbp } = priceBandThresholdsFor(AREA);
  const yOf = (price: number) => glassLevelY(price, scaleMaxGbp);

  // The engine is built before the first paint, so the figure never shows
  // empty, and it is torn down with the glass.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const svg = svgRef.current;
    const beer = beerRef.current;
    const foam = foamRef.current;
    const stream = streamRef.current;
    const pointer = pointerRef.current;
    const figure = figureRef.current;
    if (!root || !svg || !beer || !foam || !stream || !pointer || !figure) return;
    const bubbles = Array.from(bubblesRef.current?.querySelectorAll("circle") ?? []);
    const engine = createEngine(
      { svg, beer, foam, stream, pointer, figure, bubbles },
      scaleMaxGbp,
      prefersReducedMotion(),
      root,
    );
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [scaleMaxGbp]);

  const selectedPrice = selected?.priceGbp ?? 0;
  useEffect(() => {
    engineRef.current?.pour(selectedPrice);
  }, [selectedId, selectedPrice]);

  if (!selected) return null;

  const scaleMarks = [
    { price: scaleMaxGbp, band: null, edge: "top" },
    { price: averageMaxGbp, band: priceBand(averageMaxGbp, AREA), edge: "upper" },
    { price: cheapMaxGbp, band: priceBand(cheapMaxGbp, AREA), edge: "lower" },
    { price: 0, band: null, edge: "floor" },
  ] as const;

  const bandSegments = [
    { band: "cheap", from: 0, to: cheapMaxGbp },
    { band: "average", from: cheapMaxGbp, to: averageMaxGbp },
    { band: "expensive", from: averageMaxGbp, to: scaleMaxGbp },
  ] as const;

  return (
    <section ref={rootRef} className="wildGlass" aria-label="The price glass">
      <div className="wildGlassStage">
        <button
          type="button"
          className="wildGlassPour"
          onClick={() => engineRef.current?.pour(selectedPrice, { fromEmpty: true })}
          aria-label={`Pour ${selected.title} again`}
        >
          <svg
            ref={svgRef}
            className="wildGlassSvg"
            viewBox={`0 0 ${GLASS_VIEW_W} ${GLASS_VIEW_H}`}
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <clipPath id={ids.clip}>
                <path d={GLASS_INNER_PATH} />
              </clipPath>
              <linearGradient id={ids.beer} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className="wildGlassStopTop" />
                <stop offset="0.35" className="wildGlassStopMid" />
                <stop offset="1" className="wildGlassStopDeep" />
              </linearGradient>
              <linearGradient id={ids.body} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" className="wildGlassShade" stopOpacity="0.28" />
                <stop offset="0.3" className="wildGlassShade" stopOpacity="0" />
                <stop offset="0.62" className="wildGlassShade" stopOpacity="0" />
                <stop offset="1" className="wildGlassShade" stopOpacity="0.34" />
              </linearGradient>
            </defs>

            <rect
              ref={streamRef}
              className="wildGlassStream"
              x="106"
              y="0"
              width="8"
              height="0"
              rx="4"
              opacity="0"
            />

            <path className="wildGlassInside" d={GLASS_INNER_PATH} />
            <g clipPath={`url(#${ids.clip})`}>
              <rect ref={beerRef} x="0" y="0" width={GLASS_VIEW_W} height={GLASS_VIEW_H + 40} fill={`url(#${ids.beer})`} />
              <g ref={bubblesRef} className="wildGlassFizz">
                {BUBBLES.map((bubble, index) => (
                  <circle key={index} cx="0" cy="0" r={bubble.r.toFixed(2)} opacity="0" />
                ))}
              </g>
              <path ref={foamRef} className="wildGlassFoam" d="" />
              <rect x="0" y="0" width={GLASS_VIEW_W} height={GLASS_VIEW_H} fill={`url(#${ids.body})`} />
              {[averageMaxGbp, cheapMaxGbp].map((edge) => (
                <line
                  key={edge}
                  className="wildGlassEdge"
                  x1="30"
                  x2="190"
                  y1={yOf(edge)}
                  y2={yOf(edge)}
                />
              ))}
              <path className="wildGlassSheen" d="M54 64 L58 160 Q50 182 60 214 L70 372" />
              <path className="wildGlassSheen wildGlassSheen--thin" d="M168 70 L165 140" />
            </g>
            <path className="wildGlassOutline" d={GLASS_INNER_PATH} />
            <path className="wildGlassBase" d={GLASS_BASE_PATH} />

            {bandSegments.map((segment) => (
              <line
                key={segment.band}
                className={`wildGlassBand wildGlassBand--${segment.band}`}
                x1="206"
                x2="206"
                y1={yOf(segment.from) - 2}
                y2={yOf(segment.to) + 2}
              />
            ))}
            <g ref={pointerRef}>
              <path className="wildGlassPointer" d="M192 0 L200 -5.5 L200 5.5 Z" />
            </g>
          </svg>
        </button>
        <div className="wildGlassScale" aria-hidden="true">
          {scaleMarks.map((mark) => (
            <span
              key={mark.edge}
              className={`wildGlassMark wildGlassMark--${mark.edge}${mark.band ? ` priceBand-${mark.band}` : ""}`}
              style={{ top: `${(glassLevelShare(mark.price, scaleMaxGbp) * 100).toFixed(2)}%` }}
            >
              {scaleLabel(mark.price)}
            </span>
          ))}
        </div>
      </div>

      {/* Every pour's words are laid in the same cell and only the chosen
          one shows, so the cell is as tall as the longest at this width and
          nothing under it moves when a chip is tapped. */}
      <div className="wildGlassRead">
        <div className="wildGlassStack">
          {pours.map((pour) => (
            <p
              key={pour.id}
              className="wildGlassTitle"
              data-active={pour.id === selected.id ? "true" : "false"}
            >
              {pour.title}
            </p>
          ))}
        </div>
        <p className="wildGlassFigureLine">
          <span ref={figureRef} className="wildGlassFigure" aria-hidden="true" />
        </p>
        <div className="wildGlassStack">
          {pours.map((pour) => (
            <div
              key={pour.id}
              className="wildGlassLines"
              data-active={pour.id === selected.id ? "true" : "false"}
            >
              <TextLine parts={pour.what} className="wildGlassWhat" />
              <TextLine parts={pour.source} className="wildGlassSource" />
            </div>
          ))}
        </div>
      </div>

      {/* Two rows of chips: London's own three, then the boroughs. A phone
          runs both as one sideways row, so the glass keeps the primary action
          on the first screen; a wider screen names each row. */}
      <div className="wildGlassChips">
        {CHIP_GROUPS.map((group) => {
          const members = pours.filter((pour) => pour.group === group.id);
          if (members.length === 0) return null;
          const labelId = `${uid}-${group.id}`;
          return (
            <div key={group.id} className="wildGlassChipRow" role="group" aria-labelledby={labelId}>
              <span className="wildGlassChipRowName" id={labelId}>
                {group.name}
              </span>
              {members.map((pour) => (
                <Chip
                  key={pour.id}
                  aria-pressed={pour.id === selected.id}
                  onClick={() => setSelectedId(pour.id)}
                >
                  {pour.chip}
                </Chip>
              ))}
            </div>
          );
        })}
      </div>

      <p className="sr-only" aria-live="polite">
        {`${selected.title}: ${formatGbp(selected.priceGbp)}. Cheap up to ${formatGbp(cheapMaxGbp)}, average up to ${formatGbp(averageMaxGbp)}.`}
      </p>
    </section>
  );
}
