"use client";

// StarRating (PRD E3): the one star row, in two modes.
//
//   • DISPLAY — a read-only 5-star row with true half-star rendering (a
//     clipped filled overlay on an outline row), role="img" with the value in
//     the accessible name. `value: null` renders nothing filled — an unrated
//     item is honestly blank, never zero stars.
//   • INTERACTIVE — a keyboard-accessible picker: role="slider",
//     aria-valuenow/-min/-max/-text. Arrows adjust by `step` (default 0.5).
//     Home/End jump to 1/5, Enter or Space commits, Escape reverts. Pointer:
//     click anywhere on the row. The position snaps to the configured step
//     and commits immediately.
//
// starRating.css owns the default `--rating-accent` colour. Categories change
// that property instead of adding CSS.

import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

import {
  RATING_MAX,
  RATING_MIN,
  RATING_STEP,
  isRatingValue,
  type RatingValue,
} from "@/lib/ratings";

import "./starRating.css";

const STAR_COUNT = 5;

function clampToStep(value: number, step: 0.5 | 1): RatingValue {
  const snapped =
    Math.round(Math.min(RATING_MAX, Math.max(RATING_MIN, value)) / step) *
    step;
  return (isRatingValue(snapped) ? snapped : RATING_MAX) as RatingValue;
}

// The five glyph cells: an outline row with a width-clipped filled row on top.
function Stars({ value, accent }: { value: number | null; accent?: string }) {
  const percent = value === null ? 0 : (value / STAR_COUNT) * 100;
  const style = accent
    ? ({ "--rating-accent": accent } as CSSProperties)
    : undefined;
  return (
    <span className="starRatingGlyphs" style={style} aria-hidden="true">
      <span className="starRatingRow starRatingRow--empty">★★★★★</span>
      <span className="starRatingRow starRatingRow--fill" style={{ width: `${percent}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

export type StarRatingProps = {
  /** The value to show: an aggregate or the viewer's own vote. Null = unrated
   *  (blank stars — never rendered as zero). */
  value: number | null;
  /** Accessible name for the row, e.g. "The Grapes community rating". */
  label: string;
  /** Interactive picker mode; requires onRate. */
  interactive?: boolean;
  /** Called with the committed value (Enter/Space, or a click). */
  onRate?: (value: RatingValue) => void;
  /** Optional category colour override. */
  accent?: string;
  /** Compact sizing for dense rows (the drink menu); large for a thumb. */
  size?: "sm" | "md" | "lg";
  step?: 0.5 | 1;
  className?: string;
};

export default function StarRating({
  value,
  label,
  interactive = false,
  onRate,
  accent,
  size = "md",
  step = RATING_STEP,
  className,
}: StarRatingProps) {
  // The keyboard-adjusted, not-yet-committed value (interactive mode only).
  const [draft, setDraft] = useState<RatingValue | null>(null);
  const [previousValue, setPreviousValue] = useState(value);
  if (previousValue !== value) {
    setPreviousValue(value);
    setDraft(null);
  }

  const classes = ["starRating", `starRating--${size}`, className]
    .filter(Boolean)
    .join(" ");

  if (!interactive || !onRate) {
    return (
      <span
        className={classes}
        role="img"
        aria-label={
          value === null ? `${label}: not rated yet` : `${label}: ${value} out of 5 stars`
        }
      >
        <Stars value={value} accent={accent} />
      </span>
    );
  }

  const shown = draft ?? (value !== null ? clampToStep(value, step) : null);

  const commit = (next: RatingValue) => {
    setDraft(null);
    onRate(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    const current = shown ?? 3;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        setDraft(clampToStep(current + step, step));
        break;
      case "ArrowLeft":
      case "ArrowDown":
        setDraft(clampToStep(current - step, step));
        break;
      case "Home":
        setDraft(RATING_MIN as RatingValue);
        break;
      case "End":
        setDraft(RATING_MAX as RatingValue);
        break;
      case "Enter":
      case " ":
        if (draft !== null) commit(draft);
        break;
      case "Escape":
        setDraft(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const fraction = (event.clientX - box.left) / box.width;
    commit(clampToStep(fraction * STAR_COUNT, step));
  };

  return (
    <span
      className={`${classes} starRating--interactive`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={RATING_MIN}
      aria-valuemax={RATING_MAX}
      aria-valuenow={shown ?? RATING_MIN}
      aria-valuetext={
        shown === null
          ? "Not rated yet. Use arrow keys to pick, Enter to save"
          : `${shown} out of 5 stars${draft !== null ? ". Press Enter to save" : ""}`
      }
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    >
      <Stars value={shown} accent={accent} />
    </span>
  );
}
