"use client";

import type { Route } from "next";
import Link from "next/link";
import { Pause, Play } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { PintPriceBadge } from "@/components/PriceBadge";
import { IconButton } from "@/components/ui/icon-button";
import { beltLapMs, beltPath, beltPerimeter, beltPoint, type BeltTrack } from "@/lib/pintBelt";
import { tonightCheapPintChainLabel, type TonightCheapPint } from "@/lib/tonightCheapPints";

import "./tonightPintBelt.css";

const BELT_HEIGHT = 260;
const MAT_SIZE = 112;
/** Past this many px a press is a drag, and the mat under it is not opened. */
const DRAG_SLOP = 6;
/** Momentum left after each 16ms frame of a flick. */
const FRICTION = 0.94;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Tonight's cheapest listed pints as beer mats riding a bar's conveyor belt.
 *
 * Bookmarked on 21st.dev as the Sushi Conveyor Belt Menu and rebuilt for a
 * quiet night: the mats are the same real rows the list beside it prints (the
 * phone keeps that list, and so does every reader the belt is hidden from),
 * each wearing the one price badge, its pub's name and its chain where it has
 * one. The belt runs faster as last orders comes near (lib/pintBelt.ts).
 *
 * A pointer resting on the belt stops it, and so does focus on a mat. A press
 * and drag spins it by hand and a flick carries on with momentum. The pause
 * control stops it for good (WCAG 2.2.2), and a reader who asked for less
 * motion finds it already stopped, with the drag still theirs. The mats move
 * by transform alone, written straight to each mat, and the loop sleeps while
 * the belt is off screen or the tab is hidden.
 */
export default function TonightPintBelt({ rows }: { rows: readonly TonightCheapPint[] }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const matRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const progressRef = useRef(0);
  const velocityRef = useRef(0);
  const holdRef = useRef({ hover: false, focus: false, drag: false });
  const dragRef = useRef<{ x: number; time: number; moved: number; velocity: number } | null>(null);
  const draggedRef = useRef(false);
  const visibleRef = useRef(true);
  const [width, setWidth] = useState(0);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const [userPaused, setUserPaused] = useState<boolean | null>(null);
  const paused = userPaused ?? reducedMotion;
  const pausedRef = useRef(paused);
  const reducedRef = useRef(reducedMotion);
  useEffect(() => {
    pausedRef.current = paused;
    reducedRef.current = reducedMotion;
  }, [paused, reducedMotion]);

  const widthRef = useRef(0);
  const track: BeltTrack = { width, height: BELT_HEIGHT, mat: MAT_SIZE };

  const trackNow = useCallback(
    (): BeltTrack => ({ width: widthRef.current, height: BELT_HEIGHT, mat: MAT_SIZE }),
    [],
  );

  const place = useCallback(() => {
    const current = trackNow();
    if (current.width <= 0) return;
    const mats = matRefs.current;
    mats.forEach((mat, index) => {
      if (!mat) return;
      const { x, y } = beltPoint(current, progressRef.current + index / mats.length);
      mat.style.transform = `translate3d(${x - MAT_SIZE / 2}px, ${y - MAT_SIZE / 2}px, 0)`;
    });
  }, [trackNow]);

  // The belt stays undrawn (and the list beside it stays up) until it has a
  // width to lay its mats on, so it is measured off the box it will fill:
  // its own box has no width while it is still hidden.
  useLayoutEffect(() => {
    const host = frameRef.current?.parentElement?.parentElement;
    if (!host) return;
    const measure = () => {
      widthRef.current = host.clientWidth;
      setWidth(host.clientWidth);
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    matRefs.current.length = rows.length;
    place();
  }, [place, width, rows.length]);

  // The loop sleeps while the belt is off screen, hidden by the phone layout
  // (display: none never intersects) or in a hidden tab, and wakes when any
  // of those ends.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const awake = () => visibleRef.current && document.visibilityState !== "hidden";
    const tick = (now: number) => {
      const elapsed = Math.min(64, now - last);
      last = now;
      const hold = holdRef.current;
      if (!hold.drag) {
        if (velocityRef.current !== 0) {
          progressRef.current += velocityRef.current * elapsed;
          velocityRef.current *= FRICTION ** (elapsed / 16);
          if (Math.abs(velocityRef.current) < 1e-6) velocityRef.current = 0;
          place();
        } else if (!pausedRef.current && !hold.hover && !hold.focus) {
          progressRef.current += elapsed / beltLapMs(new Date());
          place();
        }
      }
      raf = awake() ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => {
      if (raf || !awake()) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", wake);
    const frame = frameRef.current;
    let observer: IntersectionObserver | null = null;
    if (frame && typeof IntersectionObserver === "function") {
      visibleRef.current = false;
      observer = new IntersectionObserver(([entry]) => {
        visibleRef.current = entry?.isIntersecting ?? false;
        wake();
      });
      observer.observe(frame);
    }
    wake();
    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", wake);
    };
  }, [place]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // One finger or one button drives the belt; a second is ignored.
    if (dragRef.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    dragRef.current = { x: event.clientX, time: event.timeStamp, moved: 0, velocity: 0 };
    draggedRef.current = false;
    velocityRef.current = 0;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    drag.moved += Math.abs(dx);
    if (!holdRef.current.drag && drag.moved > DRAG_SLOP) {
      holdRef.current.drag = true;
      draggedRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!holdRef.current.drag) {
      drag.x = event.clientX;
      return;
    }
    const perimeter = beltPerimeter(trackNow()) || 1;
    const step = dx / perimeter;
    const dt = Math.max(1, event.timeStamp - drag.time);
    progressRef.current += step;
    drag.velocity = step / dt;
    drag.x = event.clientX;
    drag.time = event.timeStamp;
    place();
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!holdRef.current.drag || !drag) return;
    holdRef.current.drag = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // A flick carries on and slows; less motion keeps only the hand's move.
    if (!reducedRef.current) velocityRef.current = drag.velocity;
  }

  return (
    <div className="pintBelt" data-ready={width > 0 ? "" : undefined}>
      <div
        ref={frameRef}
        className="pintBeltFrame"
        role="group"
        aria-roledescription="belt"
        aria-label="Cheapest listed pints on a moving belt"
        style={{ height: BELT_HEIGHT }}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") holdRef.current.hover = true;
        }}
        onPointerLeave={() => {
          holdRef.current.hover = false;
        }}
        onFocus={() => {
          holdRef.current.focus = true;
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            holdRef.current.focus = false;
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(event) => {
          // The press that spun the belt is not a tap on the mat under it.
          if (!draggedRef.current) return;
          draggedRef.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {width > 0 ? (
          <svg className="pintBeltTrack" width={width} height={BELT_HEIGHT} aria-hidden="true" focusable="false">
            <path d={beltPath(track)} />
          </svg>
        ) : null}
        {rows.map((row, index) => (
          <Link
            key={row.venueId}
            ref={(node) => {
              matRefs.current[index] = node;
            }}
            prefetch={false}
            href={`/map?sel=${encodeURIComponent(row.venueId)}` as Route}
            className="pintBeltMat"
            style={{ width: MAT_SIZE, height: MAT_SIZE }}
            draggable={false}
          >
            <span className="pintBeltMatName">{row.name}</span>
            <PintPriceBadge priceGbp={row.priceGbp} venueId={row.venueId} />
            <span className="pintBeltMatMeta">
              {row.chain ? tonightCheapPintChainLabel(row.chain) : row.borough}
            </span>
          </Link>
        ))}
      </div>
      <IconButton
        variant="ghost"
        className="pintBeltPause"
        aria-label="Stop the belt"
        aria-pressed={paused}
        onClick={() => {
          velocityRef.current = 0;
          setUserPaused(!paused);
        }}
      >
        {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
      </IconButton>
    </div>
  );
}
