"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { IconButton } from "@/components/ui/icon-button";

import "./recapWashingLine.css";

export type WashingLinePhoto = {
  id: string;
  url: string;
  caption: string | null;
  venueName: string | null;
};

const CARD_WIDTH = 184;
const CARD_GAP = 28;
const SAG = 34;
/** The string's two ends hang this far below the top of the line's box. */
const LINE_TOP = 14;
/** Room under the lowest polaroid for its shadow and a swing. */
const LINE_FOOT = 16;
/** Past this many px a press is a drag. */
const DRAG_SLOP = 6;
/** The most a polaroid swings either way while it is dragged, in degrees. */
const MAX_SWING = 9;
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

/** Where the string hangs at `x`: a parabola from both ends, `SAG` deep at the middle. */
export function washingLineDrop(x: number, width: number, sag = SAG): number {
  if (width <= 0) return 0;
  const t = x / width;
  return 4 * sag * t * (1 - t);
}

/** The box the line holds before it has measured (recapWashingLine.css). */
const LINE_MIN_HEIGHT = 284;

/**
 * The line's box for a polaroid this tall: the string, its deepest sag, the
 * card and a margin. It never drops below the box it held before measuring,
 * so a short caption does not shift the page once the line has measured.
 */
export function washingLineHeight(cardHeight: number): number {
  return Math.max(LINE_MIN_HEIGHT, LINE_TOP + SAG + cardHeight + LINE_FOOT);
}

function counterLabel(index: number, total: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(index + 1)} / ${pad(total)}`;
}

/**
 * The night's shared photos pegged to a string of festoon lights, the way a
 * pub garden hangs them.
 *
 * Bookmarked on 21st.dev as the Hanging Polaroid Image Carousel and rebuilt
 * for the recap: only the consent-approved, signed photos the page already
 * shows, each with its own caption and the pub it was taken in. Drag the line
 * and the polaroids slide along it and swing with the speed of your hand,
 * then settle hanging straight, because a tilt at rest is kept for prices
 * (DESIGN.md). The bulb over the photo in front is lit; the rest are off.
 *
 * It never moves by itself (no autoplay, WCAG 2.2.2). Previous and Next, the
 * arrow keys and the counter do what the drag does, and a reader who asked for
 * less motion gets the slide without the swing or the glide.
 */
export default function RecapWashingLine({ photos }: { photos: readonly WashingLinePhoto[] }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragRef = useRef<{ startX: number; lastX: number; lastTime: number; offset: number; velocity: number; dragging: boolean } | null>(null);
  const widthRef = useRef(0);
  const [width, setWidth] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);
  const [index, setIndex] = useState(0);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const total = photos.length;

  const layout = useCallback(
    (current: number, offset: number, swing: number, gliding: boolean) => {
      const lineWidth = widthRef.current;
      if (lineWidth <= 0) return;
      cardRefs.current.forEach((card, cardIndex) => {
        if (!card) return;
        const centre = lineWidth / 2 + (cardIndex - current) * (CARD_WIDTH + CARD_GAP) + offset;
        const drop = washingLineDrop(centre, lineWidth);
        card.style.transform = `translate3d(${centre - CARD_WIDTH / 2}px, ${LINE_TOP + drop}px, 0)`;
        card.dataset.gliding = gliding ? "true" : "false";
        card.style.setProperty("--washing-line-swing", `${swing}deg`);
      });
    },
    [],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      widthRef.current = viewport.clientWidth;
      setWidth(viewport.clientWidth);
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // The line is as tall as its tallest polaroid hangs, so a long caption is
  // read whole, as the grid it replaced printed it (a caption runs to 500
  // characters, lib/nightMemory.ts). Re-measured when a card's own height
  // changes: a font arriving, a narrower screen.
  useLayoutEffect(() => {
    const cards = cardRefs.current.filter((card): card is HTMLDivElement => card !== null);
    const measure = () => setCardHeight(Math.max(0, ...cards.map((card) => card.offsetHeight)));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    for (const card of cards) observer.observe(card);
    return () => observer.disconnect();
  }, [total]);

  useLayoutEffect(() => {
    cardRefs.current.length = total;
    layout(index, 0, 0, !reducedMotion);
  }, [index, layout, reducedMotion, total, width]);

  const go = useCallback(
    (next: number) => setIndex(Math.max(0, Math.min(total - 1, next))),
    [total],
  );

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    dragRef.current = {
      startX: event.clientX,
      lastX: event.clientX,
      lastTime: event.timeStamp,
      offset: 0,
      velocity: 0,
      dragging: false,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const offset = event.clientX - drag.startX;
    if (!drag.dragging) {
      if (Math.abs(offset) <= DRAG_SLOP) return;
      drag.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const dt = Math.max(1, event.timeStamp - drag.lastTime);
    drag.velocity = (event.clientX - drag.lastX) / dt;
    drag.lastX = event.clientX;
    drag.lastTime = event.timeStamp;
    // Past either end the line gives a little and no more.
    const atStart = index === 0 && offset > 0;
    const atEnd = index === total - 1 && offset < 0;
    drag.offset = atStart || atEnd ? offset / 3 : offset;
    // A polaroid trails the hand that pulls the line, as a peg would let it.
    const swing = reducedMotion
      ? 0
      : Math.max(-MAX_SWING, Math.min(MAX_SWING, -drag.velocity * 14));
    layout(index, drag.offset, swing, false);
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const step = CARD_WIDTH + CARD_GAP;
    // A quick flick moves one photo even when the hand travelled little.
    const flick = Math.abs(drag.velocity) > 0.45 ? -Math.sign(drag.velocity) : 0;
    const moved = Math.round(-drag.offset / step) || flick;
    const next = Math.max(0, Math.min(total - 1, index + moved));
    // Hang straight again from wherever the hand let go: the glide and the
    // settle run from this frame.
    layout(index, drag.offset, 0, !reducedMotion);
    if (next === index) layout(index, 0, 0, !reducedMotion);
    else setIndex(next);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") go(index - 1);
    else if (event.key === "ArrowRight") go(index + 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(total - 1);
    else return;
    event.preventDefault();
  }

  return (
    <div className="washingLine" aria-roledescription="carousel" aria-label="Moments the crew shared">
      <div
        ref={viewportRef}
        className="washingLineViewport"
        data-ready={width > 0 ? "" : undefined}
        style={cardHeight > 0 ? { height: washingLineHeight(cardHeight) } : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {width > 0 ? (
          <svg className="washingLineString" width={width} height={LINE_TOP + SAG + 4} aria-hidden="true" focusable="false">
            <path d={`M 0 ${LINE_TOP} Q ${width / 2} ${LINE_TOP + SAG * 2} ${width} ${LINE_TOP}`} />
          </svg>
        ) : null}
        {photos.map((photo, photoIndex) => {
          const current = photoIndex === index;
          return (
            <div
              key={photo.id}
              ref={(node) => {
                cardRefs.current[photoIndex] = node;
              }}
              className="washingLineCard"
              style={{ width: CARD_WIDTH }}
              role="group"
              aria-roledescription="slide"
              aria-label={`${photoIndex + 1} of ${total}`}
              aria-hidden={current ? undefined : true}
              data-current={current ? "true" : "false"}
            >
              <span className="washingLineBulb" aria-hidden="true" />
              <figure className="washingLinePolaroid">
                <span className="washingLinePeg" aria-hidden="true" />
                {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL the image optimiser must not cache */}
                <img
                  className="washingLinePhoto"
                  src={photo.url}
                  alt={photo.caption ?? "A moment from the night"}
                  loading="lazy"
                  draggable={false}
                />
                <figcaption className="washingLineCaption">
                  {photo.caption ? <span>{photo.caption}</span> : null}
                  {photo.venueName ? <span className="washingLineVenue">{photo.venueName}</span> : null}
                </figcaption>
              </figure>
            </div>
          );
        })}
      </div>
      <div className="washingLineControls">
        {/* aria-disabled, never disabled: a control that disables under the
            reader's focus drops that focus to the page body. */}
        <IconButton
          aria-label="Previous photo"
          aria-disabled={index === 0 || undefined}
          onClick={() => go(index - 1)}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </IconButton>
        <p className="washingLineCount" aria-live="polite">
          {counterLabel(index, total)}
        </p>
        <IconButton
          aria-label="Next photo"
          aria-disabled={index === total - 1 || undefined}
          onClick={() => go(index + 1)}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}
