"use client";

// THE SIGN FOUNDRY (wild idea 03). A pub with no photograph gets a hanging
// sign drawn from its own name: lib/wildPubSign.ts decides the board, the
// paint and the lettering from the name, and this file draws it on a wrought
// iron bracket. Only the cover variant can add a listed-pint plaque.
//
// It is a DRAWING and says so: it is lettered, framed and captioned "drawn
// from its name" on a cover or "Illustrated sign" in a photo frame.
// It must never pass for a photograph. A cover's optional plaque uses the
// page's own listed pint, painted through the price band
// (PintPriceBadge), and the line under the sign says who listed it and when.
//
// Motion: the sign swings as a damped pendulum when it comes into view and
// when it is tapped, and the plaque under it sways a beat behind. Only
// transform moves, one frame loop per sign, and it stops when the sign hangs
// still. A reader who asked for less motion gets a sign that never moves.
//
// Photo fallbacks load this drawing lazily for everyone. The historic cover
// remains behind the wild switch (components/wild/PubSignSlot.tsx).

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import { PintPriceBadge } from "@/components/PriceBadge";
import ListedPriceSource from "@/components/venue/ListedPriceSource";
import { scrollMotionBehavior } from "@/lib/scrollMotion";
import type { VenueListedPint } from "@/lib/venueListedPint";
import { prefersReducedMotion } from "@/lib/wildMode";
import {
  SIGN_AT_REST,
  SIGN_BOARD,
  SIGN_MIN_NAME_SIZE,
  SIGN_PIVOT,
  SIGN_STAGE,
  pubSignSpec,
  pushSign,
  signAtRest,
  signBoardPath,
  signBottomCentre,
  signChainAnchors,
  signLineLimit,
  signRows,
  signSafeBox,
  signSeed,
  stepSignSwing,
  type PubSignSpec,
  type SignRow,
  type SignSwing,
} from "@/lib/wildPubSign";

import "./pubSign.css";

export type PubSignProps = {
  name: string;
  area?: string;
  /** Decides whose price terciles the plaque's band is cut against. */
  venueId?: string | null;
  /** The page's listed pint. Absent or null, no plaque hangs. */
  listedPint?: VenueListedPint | null;
  /** A FOUNDING year only (lib/wildPubSign.ts signFoundingYear). */
  foundingYear?: string | null;
  /** "cover" heads a page; "compact" stands in a photo frame. */
  variant?: "cover" | "compact";
  /** True where the page has a photo wall with its own "Add a photo". */
  photoDoor?: boolean;
  className?: string;
};

const PLAQUE_STAGE_HEIGHT = SIGN_STAGE.height;
const BARE_STAGE_HEIGHT = 240;
const VIEW_PUSH = 15;
const TAP_PUSH = 24;

function useSignSwing(enabled: boolean, seed: number) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const swingRef = useRef<SVGGElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const plaqueRef = useRef<HTMLDivElement | null>(null);
  const state = useRef<SignSwing>(SIGN_AT_REST);
  const frame = useRef(0);
  const last = useRef(0);
  const visible = useRef(false);

  const paint = useCallback((swing: SignSwing) => {
    const board = `rotate(${swing.angle.toFixed(3)}deg)`;
    if (swingRef.current) swingRef.current.style.transform = board;
    if (overlayRef.current) overlayRef.current.style.transform = board;
    if (plaqueRef.current) plaqueRef.current.style.transform = `rotate(${swing.plaque.toFixed(3)}deg)`;
  }, []);

  const tick = useCallback(
    function step(now: number) {
      const seconds = last.current ? (now - last.current) / 1000 : 1 / 60;
      last.current = now;
      state.current = stepSignSwing(state.current, seconds);
      if (signAtRest(state.current) || !visible.current) {
        state.current = signAtRest(state.current) ? SIGN_AT_REST : state.current;
        paint(state.current);
        frame.current = 0;
        return;
      }
      paint(state.current);
      frame.current = window.requestAnimationFrame(step);
    },
    [paint],
  );

  const push = useCallback(
    (impulse: number) => {
      if (!enabled || prefersReducedMotion()) return;
      state.current = pushSign(state.current, impulse);
      if (!frame.current) {
        last.current = 0;
        frame.current = window.requestAnimationFrame(tick);
      }
    },
    [enabled, tick],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!enabled || !stage) return;
    let shown = false;
    // Which way the first push goes is the sign's own, so a row of signs does
    // not swing in step like a chorus line.
    const direction = seed % 2 === 0 ? 1 : -1;
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                const inView = entry.isIntersecting && entry.intersectionRatio >= 0.35;
                visible.current = entry.isIntersecting;
                if (inView && !shown) push(VIEW_PUSH * direction);
                shown = inView;
              }
            },
            { threshold: [0, 0.35, 0.6] },
          )
        : null;
    if (observer) observer.observe(stage);
    else {
      visible.current = true;
      push(VIEW_PUSH * direction);
    }
    return () => {
      observer?.disconnect();
      if (frame.current) window.cancelAnimationFrame(frame.current);
      frame.current = 0;
      state.current = SIGN_AT_REST;
    };
  }, [enabled, push, seed]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      const pivotX = box.left + box.width * (SIGN_PIVOT.x / SIGN_STAGE.width);
      visible.current = true;
      // A tap on the right of the board pushes it away to the left, and the
      // reverse: the sign moves the way a hand would send it.
      push(event.clientX >= pivotX ? TAP_PUSH : -TAP_PUSH);
    },
    [push],
  );

  return { stageRef, swingRef, overlayRef, plaqueRef, onPointerDown };
}

/**
 * Steps the lettering down until every line of the name fits the board as the
 * reader's own serif draws it. The estimate in lib/wildPubSign.ts is a close
 * guess; Georgia, Times and an Android serif all run a little differently. The
 * whole lettering block scales about its centre, which is the size stepping
 * down; past the smallest size the name is narrowed instead, the way a sign
 * writer condenses a long name. Written straight to the drawing, no re-render.
 */
function useFittedLettering(spec: PubSignSpec) {
  const lettersRef = useRef<SVGGElement | null>(null);
  useLayoutEffect(() => {
    const group = lettersRef.current;
    if (!group) return;
    group.removeAttribute("transform");
    let widest = 0;
    for (const node of group.querySelectorAll<SVGTextElement>("text.pubSign__name")) {
      if (typeof node.getComputedTextLength !== "function") continue;
      widest = Math.max(widest, node.getComputedTextLength());
    }
    const limit = signLineLimit(spec.shape);
    if (!widest || widest <= limit) return;
    const scaleX = limit / widest;
    const scaleY = Math.max(scaleX, Math.min(1, SIGN_MIN_NAME_SIZE / spec.nameSize));
    const safe = signSafeBox(spec.shape);
    const cx = safe.x + safe.width / 2;
    const cy = safe.y + safe.height / 2;
    group.setAttribute(
      "transform",
      `translate(${cx} ${cy}) scale(${scaleX.toFixed(4)} ${scaleY.toFixed(4)}) translate(${-cx} ${-cy})`,
    );
  }, [spec]);
  return lettersRef;
}

function Ornaments({ spec, rows }: { spec: PubSignSpec; rows: SignRow[] }) {
  const cx = SIGN_BOARD.x + SIGN_BOARD.width / 2;
  const the = rows.find((row) => row.kind === "the");
  const names = rows.filter((row) => row.kind === "name");
  const lastName = names.at(-1);
  if (spec.ornament === "plain") return null;
  if (spec.ornament === "rules") {
    if (the) {
      const y = the.y - the.size * 0.32;
      const gap = the.size * 1.2;
      return (
        <g className="pubSign__ornament">
          <path d={`M${cx - gap - 30} ${y} H${cx - gap}`} />
          <path d={`M${cx + gap} ${y} H${cx + gap + 30}`} />
        </g>
      );
    }
    if (!lastName) return null;
    const y = lastName.y + lastName.size * 0.3;
    return (
      <g className="pubSign__ornament">
        <path d={`M${cx - 28} ${y} H${cx + 28}`} />
      </g>
    );
  }
  const anchor = the ?? names[0];
  if (!anchor) return null;
  const y = anchor.kind === "the" ? anchor.y - anchor.size * 0.32 : anchor.y - anchor.size - 6;
  const gap = anchor.kind === "the" ? anchor.size * 1.25 : 0;
  const diamond = (x: number) => `M${x} ${y - 3.2} L${x + 3.2} ${y} L${x} ${y + 3.2} L${x - 3.2} ${y} Z`;
  return (
    <g className="pubSign__ornament pubSign__ornament--fill">
      {gap ? (
        <>
          <path d={diamond(cx - gap - 4)} />
          <path d={diamond(cx + gap + 4)} />
        </>
      ) : (
        <path d={diamond(cx)} />
      )}
    </g>
  );
}

function Bracket() {
  // A wall plate with two rivets, an arm, a scrolled brace and a finial: the
  // wrought iron a London pub sign hangs from.
  return (
    <g className="pubSign__iron" aria-hidden="true">
      <rect x="12" y="6" width="13" height="104" rx="3" />
      <circle className="pubSign__rivet" cx="18.5" cy="18" r="2.4" />
      <circle className="pubSign__rivet" cx="18.5" cy="98" r="2.4" />
      <path className="pubSign__ironLine" d="M24 26 H288" strokeWidth="6" />
      <circle className="pubSign__ironLine" cx="296" cy="26" r="7" strokeWidth="3" />
      <path className="pubSign__ironLine" d="M25 98 C34 66 62 36 116 27" strokeWidth="4" />
      <path className="pubSign__ironLine" d="M31 60 C44 42 70 38 74 50 C77 60 64 64 59 56" strokeWidth="2.6" />
      <path className="pubSign__ironLine" d="M80 31 C92 40 108 38 110 32" strokeWidth="2.2" />
      <path className="pubSign__ironLine" d="M236 26 C236 40 256 44 262 35 C266 28 256 22 250 29" strokeWidth="2.4" />
      <path className="pubSign__ironLine" d={`M${SIGN_PIVOT.x} 26 V${SIGN_PIVOT.y - 4}`} strokeWidth="3" />
    </g>
  );
}

function Board({ spec, uid }: { spec: PubSignSpec; uid: string }) {
  const rows = useMemo(() => signRows(spec), [spec]);
  const lettersRef = useFittedLettering(spec);
  const cx = SIGN_BOARD.x + SIGN_BOARD.width / 2;
  const anchors = signChainAnchors(spec.shape);
  const bottom = signBottomCentre(spec.shape);
  const outline = signBoardPath(spec.shape, 0);
  const seed = signSeed(spec.name);
  // Faint grain in the painted wood, placed by the name so it never changes.
  const grain = [0, 1, 2, 3].map((i) => SIGN_BOARD.y + 18 + i * 31 + ((seed >>> (i * 3)) % 9));

  return (
    <>
      <circle className="pubSign__ring" cx={SIGN_PIVOT.x} cy={SIGN_PIVOT.y + 4} r="5" />
      <path className="pubSign__chain" d={`M${SIGN_PIVOT.x} ${SIGN_PIVOT.y + 9} L${anchors.left[0]} ${anchors.left[1]}`} />
      <path className="pubSign__chain" d={`M${SIGN_PIVOT.x} ${SIGN_PIVOT.y + 9} L${anchors.right[0]} ${anchors.right[1]}`} />
      <defs>
        <clipPath id={`${uid}-clip`}>
          <path d={outline} />
        </clipPath>
        <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <path className="pubSign__edge" d={outline} />
      <path className="pubSign__paint" d={outline} />
      <g clipPath={`url(#${uid}-clip)`} className="pubSign__grain">
        {grain.map((y, i) => (
          <path key={i} d={`M${SIGN_BOARD.x} ${y} C${cx - 60} ${y - 3} ${cx + 40} ${y + 4} ${SIGN_BOARD.x + SIGN_BOARD.width} ${y - 1}`} />
        ))}
      </g>
      <path d={outline} fill={`url(#${uid}-sheen)`} />
      <path className="pubSign__frame" d={signBoardPath(spec.shape, 8)} />
      {spec.doubleFrame ? <path className="pubSign__frame pubSign__frame--fine" d={signBoardPath(spec.shape, 12.5)} /> : null}
      <circle className="pubSign__eye" cx={anchors.left[0]} cy={anchors.left[1]} r="3" />
      <circle className="pubSign__eye" cx={anchors.right[0]} cy={anchors.right[1]} r="3" />
      <g className="pubSign__fit" ref={lettersRef}>
        <Ornaments spec={spec} rows={rows} />
        <g className="pubSign__letters">
          {rows.map((row) => {
            const common = {
              x: cx,
              y: row.y,
              fontSize: row.size,
              letterSpacing: row.spacing,
              textAnchor: "middle" as const,
            };
            const kind = `pubSign__${row.kind}`;
            return (
              <g key={`${row.kind}-${row.y}`}>
                <text {...common} className={`${kind}Shadow pubSign__shadow`} dx="0.9" dy="1.2" aria-hidden="true">
                  {row.text}
                </text>
                <text {...common} className={kind}>
                  {row.text}
                </text>
              </g>
            );
          })}
        </g>
      </g>
      <circle className="pubSign__ring pubSign__ring--small" cx={cx} cy={bottom + 4} r="3.6" />
    </>
  );
}

function PhotoDoor() {
  // The page's own photo wall already owns "Add a photo" (or its sign-in
  // door); this only takes the reader there and hands it the focus.
  const open = () => {
    const wall = document.querySelector<HTMLElement>(".venuePhotoWall");
    if (!wall) return;
    wall.scrollIntoView({ block: "center", behavior: scrollMotionBehavior() });
    wall.querySelector<HTMLElement>(".venuePhotoWallActions button, .venuePhotoWallActions a")?.focus({ preventScroll: true });
  };
  return (
    <button type="button" className="pubSign__door" onClick={open}>
      Add a photo
    </button>
  );
}

export default function PubSign({
  name,
  area,
  venueId = null,
  listedPint = null,
  foundingYear = null,
  variant = "cover",
  photoDoor = false,
  className = "",
}: PubSignProps) {
  const spec = useMemo(() => pubSignSpec(name, { foundingYear }), [name, foundingYear]);
  const uid = `sign${signSeed(spec.name).toString(36)}${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const plaque = variant === "cover" && listedPint ? listedPint : null;
  const stageHeight = plaque ? PLAQUE_STAGE_HEIGHT : BARE_STAGE_HEIGHT;
  const { stageRef, swingRef, overlayRef, plaqueRef, onPointerDown } = useSignSwing(true, signSeed(spec.name));
  const label = variant === "compact"
    ? `Illustrated sign for ${spec.name}${area?.trim() ? `, ${area.trim()}` : ""}`
    : `${spec.name}: a sign drawn from its name${spec.since ? `, ${spec.since.toLowerCase()}` : ""}. No photo yet.`;
  const ringTop = ((signBottomCentre(spec.shape) + 7) / stageHeight) * 100;

  return (
    <figure
      className={`pubSign pubSign--${variant} ${className}`.trim()}
      data-shape={spec.shape}
      data-paint={spec.paint}
      data-ink={spec.ink}
      data-pub-sign=""
      data-wild-sign={variant === "cover" ? "" : undefined}
    >
      <div className="pubSign__stage" ref={stageRef} onPointerDown={onPointerDown}>
        <svg
          className="pubSign__art"
          viewBox={`0 0 ${SIGN_STAGE.width} ${stageHeight}`}
          role="img"
          aria-label={label}
        >
          <Bracket />
          <g className="pubSign__swing" ref={swingRef} style={{ transformOrigin: `${SIGN_PIVOT.x}px ${SIGN_PIVOT.y}px` }}>
            <Board spec={spec} uid={uid} />
          </g>
        </svg>
        {plaque ? (
          <div
            className="pubSign__overlay"
            ref={overlayRef}
            style={{ transformOrigin: `50% ${(SIGN_PIVOT.y / stageHeight) * 100}%` }}
          >
            <div className="pubSign__plaque" ref={plaqueRef} style={{ top: `${ringTop}%` }}>
              <svg className="pubSign__plaqueChains" viewBox="0 0 100 26" aria-hidden="true">
                <path d="M50 1 L14 25" />
                <path d="M50 1 L86 25" />
              </svg>
              <div className="pubSign__plaqueBoard">
                <span className="pubSign__plaqueWord">Pint</span>
                <PintPriceBadge priceGbp={plaque.priceGbp} venueId={venueId} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {variant === "cover" ? (
        <figcaption className="pubSign__caption">
          {plaque ? <ListedPriceSource evidence={plaque} className="pubSign__source" /> : null}
          <p className="pubSign__note">
            A sign drawn from its name. No photo of this pub yet.
            {photoDoor ? <> <PhotoDoor /></> : null}
          </p>
        </figcaption>
      ) : (
        <span className="pubSign__tag" aria-hidden="true">
          Illustrated sign{area?.trim() ? ` · ${area.trim()}` : ""}
        </span>
      )}
    </figure>
  );
}

/**
 * The normal photo fallback uses the real name and area only. It accepts no
 * price or founding year, so the drawing cannot introduce an unsupported fact.
 */
export function PubSignFallback({
  name,
  area,
  className = "",
  children,
}: {
  name?: string;
  area?: string;
  className?: string;
  children: ReactNode;
}) {
  if (!name?.trim()) return <>{children}</>;
  return (
    <div className={`venueImage venueImage--empty venueImage--named venueImage--sign ${className}`.trim()} data-pub-sign-fallback="">
      <PubSign name={name} area={area} variant="compact" />
    </div>
  );
}
