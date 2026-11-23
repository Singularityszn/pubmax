"use client";

import { useId, useRef, type ComponentProps } from "react";
import { X } from "lucide-react";
import { buttonVariants } from "@/components/ui/buttonVariants";
import { fairPintValueText } from "@/lib/fairPint";
import { formatPence } from "@/lib/formatGbp";
import { useMapArrivalBerth } from "../useMapArrivalBerth";
import "@/components/ui/primitives.css";
import "./fairPint.css";

export const FAIR_PINT_LOADING_LINE = "Loading prices…";

// On a phone the card spans the foot of the map, so the map-edge column parks
// above its top edge (components/nav/mobileNav.css). From 641px the corner
// controls step beside it instead (fairPint.css).
const PHONE_BERTH = {
  property: "--map-fair-pint-berth",
  media: "(max-width: 640px)",
  host: () => document.documentElement,
  measure: (node: HTMLElement) => parseFloat(getComputedStyle(node).bottom) + node.getBoundingClientRect().height,
};

export default function FairPintFrame({
  prelude = false,
  standDown = false,
  area,
  pence,
  priceStatus = "loading prices",
  countLine = FAIR_PINT_LOADING_LINE,
  slider,
  announcement = "",
  reason = "",
  failed = false,
  located = false,
  locationOff = false,
  error = "",
  pending = false,
  drawDisabled = true,
  onRetry,
  onLocation,
  onDraw,
  onClose,
}: {
  prelude?: boolean;
  /** A recovery notice on the map owns the surface, so the card steps aside until it clears. */
  standDown?: boolean;
  area: string;
  pence: number;
  priceStatus?: string;
  countLine?: string;
  slider?: ComponentProps<"input">;
  announcement?: string;
  reason?: string;
  failed?: boolean;
  located?: boolean;
  locationOff?: boolean;
  error?: string;
  pending?: boolean;
  drawDisabled?: boolean;
  onRetry?: () => void;
  onLocation?: () => void;
  onDraw?: () => void;
  onClose?: () => void;
}) {
  const reasonId = useId();
  const card = useRef<HTMLElement>(null);
  useMapArrivalBerth(card, PHONE_BERTH);
  return (
    <aside
      ref={card}
      className="fairPintCard fairPintAsk"
      aria-label="Your fair pint"
      hidden={prelude}
      data-stand-down={standDown || undefined}
      data-fair-prelude={prelude || undefined}
      suppressHydrationWarning={prelude}
    >
      <div className="fairPintHead">
        <h2>What&apos;s a fair pint to you?</h2>
        <output className="fairPintFigure" aria-live="off" suppressHydrationWarning={prelude}>
          {formatPence(pence)}
        </output>
      </div>
      <input
        suppressHydrationWarning={prelude}
        className="fairPintRange"
        name="fair-pint-price"
        type="range"
        aria-label="Fair pint price"
        min={300}
        max={800}
        step={10}
        defaultValue={prelude ? pence : undefined}
        {...slider}
        aria-valuetext={`${fairPintValueText(pence)}, ${priceStatus}`}
      />
      <div className="fairPintAnswer">
        <p className="fairPintCount">{countLine}</p>
        <span className="sr-only" aria-live="polite">{announcement}</span>
        {failed ? (
          <button type="button" className={buttonVariants({ variant: "ghost" })} onClick={onRetry}>Retry</button>
        ) : null}
        <button
          type="button"
          className={buttonVariants({ variant: "ghost" })}
          data-early-location={prelude || undefined}
          onClick={onLocation}
        >
          {located ? "Count pubs in view" : locationOff ? "Location is off" : "Use my location"}
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {pending ? <p role="status">Drawing your night…</p> : null}
      <button
        type="button"
        className={buttonVariants({})}
        aria-busy={pending}
        aria-describedby={reason ? reasonId : undefined}
        onClick={onDraw}
        disabled={drawDisabled}
      >
        Draw my night in {area}
      </button>
      {reason ? (
        // While prices load, the count line already says so; this line then only names the button's wait.
        <p id={reasonId} className={countLine === FAIR_PINT_LOADING_LINE ? "sr-only" : "fairPintReason"}>{reason}</p>
      ) : null}
      <button
        type="button"
        className={`${buttonVariants({ variant: "ghost", size: "icon" })} fairPintClose`}
        aria-label="Close"
        onClick={onClose}
      >
        <X size={20} aria-hidden="true" />
      </button>
    </aside>
  );
}
