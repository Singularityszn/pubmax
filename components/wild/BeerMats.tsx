"use client";

import type { Route } from "next";
import Link from "next/link";
import { RotateCw } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { PintPriceBadge } from "@/components/PriceBadge";
import { formatObservedDayShort } from "@/lib/dataFreshness";
import { formatGbp } from "@/lib/formatGbp";
import { namedLegacyPintPriceSource } from "@/lib/legacyPriceEvidence.mjs";
import { venueDetailUrl } from "@/lib/prefetchVenue";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import { priceBand, priceBandAreaForVenue, priceBandClass } from "@/lib/priceBand";
import { tonightCheapPintChainLabel, type TonightCheapPint } from "@/lib/tonightCheapPints";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { prefersReducedMotion } from "@/lib/wildMode";

import "./beerMats.css";

/**
 * BEER MATS THAT FLIP (round-two wild idea 06, docs/plans/DESIGN_UX_PLAN.md
 * section 12). Loaded only while the wild switch is on (TonightCheapPints).
 *
 * Tonight's cheapest listed pints as round beer mats. The front prints the
 * pub's name and its area round the rim, and the price big in the middle in
 * its band, with the day that price was read under it. A tap, or Enter, flips
 * the mat to its back: the drink, who listed the price and when, and a door
 * into the app's own price log for that pub.
 *
 * Every word on a mat is a fact the app already holds. The rows are the ones
 * the quiet-night list prints (lib/tonightCheapPints.ts); the drink and the
 * publisher are read off that pub's own detail (`/api/venue/[id]`), from the
 * very row whose figure the mat prints. A fact the record does not hold is
 * said to be missing, never filled in.
 *
 * Each mat is a real button: it says the pub and the price, and aria-pressed
 * says which side is up. A phone swipes a snap row with the next mat peeking
 * in; from 641px the mats sit on the bar in a grid, and a mouse tilts the one
 * under it. With reduced motion the mat turns over at once and nothing tilts.
 */

/** The rest angle of each mat, so the row reads as mats put down on a bar. */
const MAT_TILTS = [-4, 3, -2, 5] as const;
/** The most a mat leans towards a mouse, in degrees. */
const MAT_HOVER_TILT = 9;

const RIM_RADIUS = 72;
const RIM_LENGTH = 2 * Math.PI * RIM_RADIUS;
/** A capital and its tracking in Space Grotesk bold, as a share of the font size. */
const RIM_ADVANCE = 0.76;
const RIM_FONT_MAX = 17;
const RIM_FONT_MIN = 9;
/** Below this share of the ring a single run reads stretched, so it runs twice. */
const RIM_FILL_MIN = 0.66;

const READ_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

type MatSource =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "read"; drink: string | null; publisher: string | null };

type DetailPrice = {
  pint_name?: string | null;
  price_gbp?: number | null;
  pub_url?: string | null;
  scraped_at_values?: string | null;
};

/** What a pub's detail says about the row behind its printed cheapest pint. */
export function matSourceFromDetail(body: unknown, priceGbp: number): MatSource {
  const prices = (body as { venue?: { prices?: unknown } } | null)?.venue?.prices;
  if (!Array.isArray(prices)) return { state: "unavailable" };
  const row = (prices as DetailPrice[]).find((price) => price?.price_gbp === priceGbp);
  if (!row) return { state: "unavailable" };
  const drink = typeof row.pint_name === "string" && row.pint_name.trim() ? row.pint_name.trim() : null;
  return {
    state: "read",
    drink,
    publisher: namedLegacyPintPriceSource(row)?.label ?? null,
  };
}

/** A pub's detail read in the last five minutes is still the answer. */
const DETAIL_FRESH_MS = 5 * 60_000;

function isVenueDetail(body: unknown): boolean {
  return Array.isArray((body as { venue?: { prices?: unknown } } | null)?.venue?.prices);
}

/** The rim's words: the pub, its area and its chain, run once or twice round. */
export function matRim(row: TonightCheapPint): {
  text: string;
  fontSize: number;
  lengthAdjust: "spacing" | "spacingAndGlyphs";
  /** Degrees that centre the pub's first name on the top of the mat. */
  turn: number;
} {
  const parts = [row.name, row.borough];
  if (row.chain) parts.push(tonightCheapPintChainLabel(row.chain));
  const phrase = `${parts.join(" · ")} · `.toLocaleUpperCase("en-GB");
  const once = phrase.length * RIM_ADVANCE;
  let runs = 1;
  let fontSize = Math.min(RIM_FONT_MAX, RIM_LENGTH / once);
  while (once * runs * fontSize < RIM_FILL_MIN * RIM_LENGTH && runs < 4) {
    runs += 1;
    fontSize = Math.min(RIM_FONT_MAX, RIM_LENGTH / (once * runs));
  }
  // Type that has room to spare keeps its shapes and spreads its letters;
  // type sized to fit the ring may be eased a hair either way to close it.
  const roomy = fontSize >= RIM_FONT_MAX;
  fontSize = Math.max(RIM_FONT_MIN, fontSize);
  // The ring is laid out to its exact length, so each letter takes an even
  // share of it whatever the font did.
  const nameShare = row.name.length / (phrase.length * runs);
  return {
    text: phrase.repeat(runs),
    fontSize: Math.round(fontSize * 10) / 10,
    lengthAdjust: roomy ? "spacing" : "spacingAndGlyphs",
    turn: Math.round((90 - nameShare * 180) * 10) / 10,
  };
}

function sourceLine(source: MatSource): string {
  if (source.state === "loading") return "Checking who listed it";
  if (source.state === "unavailable") return "Publisher could not be checked";
  return source.publisher ? `Listed by ${source.publisher}` : "No publisher recorded";
}

function MatRim({ row, idBase }: { row: TonightCheapPint; idBase: string }) {
  const rim = matRim(row);
  const pathId = `${idBase}-rim`;
  const grainId = `${idBase}-grain`;
  return (
    <svg className="beerMatPrint" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <path
          id={pathId}
          d={`M ${100 - RIM_RADIUS} 100 a ${RIM_RADIUS} ${RIM_RADIUS} 0 1 1 ${2 * RIM_RADIUS} 0 a ${RIM_RADIUS} ${RIM_RADIUS} 0 1 1 ${-2 * RIM_RADIUS} 0`}
        />
        {/* The pressed board a mat is printed on: a fine grain in the ink. */}
        <filter id={grainId} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="noise" />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 -0.2"
            result="speckle"
          />
          <feComposite in="SourceGraphic" in2="speckle" operator="in" />
        </filter>
      </defs>
      <circle className="beerMatGrain" cx="100" cy="100" r="99" filter={`url(#${grainId})`} />
      <circle className="beerMatBand" cx="100" cy="100" r="94" />
      <circle className="beerMatHairline" cx="100" cy="100" r="86.5" />
      <circle className="beerMatHairline" cx="100" cy="100" r="62" />
      <text className="beerMatRimText" fontSize={rim.fontSize} transform={`rotate(${rim.turn} 100 100)`}>
        <textPath href={`#${pathId}`} textLength={RIM_LENGTH.toFixed(1)} lengthAdjust={rim.lengthAdjust}>
          {rim.text}
        </textPath>
      </text>
    </svg>
  );
}

function BeerMat({
  row,
  index,
  flipped,
  source,
  onToggle,
}: {
  row: TonightCheapPint;
  index: number;
  flipped: boolean;
  source: MatSource;
  onToggle: (venueId: string) => void;
}) {
  const idBase = useId();
  const matRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef(0);
  const band = priceBand(row.priceGbp, priceBandAreaForVenue(row.venueId));
  const price = formatGbp(row.priceGbp);
  const area = row.chain ? `${row.borough}, ${tonightCheapPintChainLabel(row.chain)}` : row.borough;
  const readAt = row.observedAt ? new Date(row.observedAt) : null;

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  // A fine pointer leans the mat towards it, a little. The angle is written
  // straight to the mat once a frame, never through a render.
  const lean = useCallback((x: number, y: number) => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const mat = matRef.current;
      if (!mat) return;
      mat.style.setProperty("--mat-lean-x", `${(-y * MAT_HOVER_TILT).toFixed(2)}deg`);
      mat.style.setProperty("--mat-lean-y", `${(x * MAT_HOVER_TILT).toFixed(2)}deg`);
    });
  }, []);

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || prefersReducedMotion()) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    lean((event.clientX - box.left) / box.width - 0.5, (event.clientY - box.top) / box.height - 0.5);
  }

  const style = {
    "--mat-rest": `${MAT_TILTS[index % MAT_TILTS.length]}deg`,
    "--mat-delay": `${index * 90}ms`,
  } as CSSProperties;

  return (
    <li className="beerMatSlot" style={style}>
      <div
        ref={matRef}
        className={`beerMat ${priceBandClass(band)}`}
        data-flipped={flipped ? "" : undefined}
        onPointerMove={onPointerMove}
        onPointerLeave={() => lean(0, 0)}
      >
        <button
          type="button"
          className="beerMatToggle"
          aria-pressed={flipped}
          aria-label={`${row.name}, ${area}, ${price}`}
          onClick={() => onToggle(row.venueId)}
        />
        <div className="beerMatSpin">
          <div className="beerMatFace beerMatFront" aria-hidden="true">
            <MatRim row={row} idBase={idBase} />
            <span className="beerMatFigure">
              <span className={`beerMatPrice ${priceBandClass(band)}`}>{price}</span>
              {readAt ? (
                <time className="beerMatDay" dateTime={row.observedAt ?? undefined}>
                  {formatObservedDayShort(readAt)}
                </time>
              ) : null}
              <RotateCw className="beerMatTurn" size={14} aria-hidden="true" />
            </span>
          </div>
          <div className="beerMatFace beerMatBack" inert={!flipped}>
            <span className="beerMatBackBody">
              <PintPriceBadge priceGbp={row.priceGbp} venueId={row.venueId} />
              {source.state === "read" && source.drink ? (
                <span className="beerMatDrink">{source.drink}</span>
              ) : null}
              <span className="beerMatSource">
                {sourceLine(source)}
                <br />
                {readAt ? (
                  <time dateTime={row.observedAt ?? undefined}>{READ_DAY.format(readAt)}</time>
                ) : (
                  "Read day not recorded"
                )}
              </span>
              <Link
                prefetch={false}
                className="beerMatLog"
                href={`${venueMapUrl(row.venueId)}&log=1` as Route}
              >
                Paid less? Log it
              </Link>
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}

export default function BeerMats({ rows }: { rows: readonly TonightCheapPint[] }) {
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set());
  const [sources, setSources] = useState<ReadonlyMap<string, MatSource>>(() => new Map());

  // Each mat's back is read from the pub's own detail as the mats land,
  // through the shared surface read, so the map's sheet and the mats ask once.
  useEffect(() => {
    const controller = new AbortController();
    const settle = (venueId: string, source: MatSource) =>
      setSources((current) => new Map(current).set(venueId, source));
    for (const row of rows) {
      void loadSurfaceJson<unknown>(
        venueDetailUrl(row.venueId),
        { signal: controller.signal, freshForMs: DETAIL_FRESH_MS, validate: isVenueDetail },
        (body) => settle(row.venueId, matSourceFromDetail(body, row.priceGbp)),
      ).then((outcome) => {
        if (outcome === "failed" && !controller.signal.aborted) {
          settle(row.venueId, { state: "unavailable" });
        }
      });
    }
    return () => controller.abort();
  }, [rows]);

  const toggle = useCallback((venueId: string) => {
    setFlipped((current) => {
      const next = new Set(current);
      if (next.has(venueId)) next.delete(venueId);
      else next.add(venueId);
      return next;
    });
  }, []);

  return (
    <ul className="beerMats" aria-label="Beer mats, cheapest first">
      {rows.map((row, index) => (
        <BeerMat
          key={row.venueId}
          row={row}
          index={index}
          flipped={flipped.has(row.venueId)}
          source={sources.get(row.venueId) ?? { state: "loading" }}
          onToggle={toggle}
        />
      ))}
    </ul>
  );
}
