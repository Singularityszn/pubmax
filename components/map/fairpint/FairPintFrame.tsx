import type { ComponentProps } from "react";
import { X } from "lucide-react";
import { buttonVariants } from "@/components/ui/buttonVariants";
import "@/components/ui/primitives.css";
import "./fairPint.css";

export const FAIR_PINT_LOADING_LINE = "Loading prices…";

export default function FairPintFrame({
  prelude = false,
  area,
  figure,
  countLine = FAIR_PINT_LOADING_LINE,
  slider,
  announcement = "",
  reason = "",
  failed = false,
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
  area: string;
  figure: string;
  countLine?: string;
  slider?: ComponentProps<"input">;
  announcement?: string;
  reason?: string;
  failed?: boolean;
  locationOff?: boolean;
  error?: string;
  pending?: boolean;
  drawDisabled?: boolean;
  onRetry?: () => void;
  onLocation?: () => void;
  onDraw?: () => void;
  onClose?: () => void;
}) {
  return (
    <aside
      className="fairPintCard"
      aria-label="Your fair pint"
      hidden={prelude}
      data-fair-prelude={prelude || undefined}
      suppressHydrationWarning={prelude}
    >
      <h2>What&apos;s a fair pint to you?</h2>
      <output className="fairPintFigure" aria-live="off" suppressHydrationWarning={prelude}>
        {figure}
      </output>
      <input
        suppressHydrationWarning={prelude}
        className="fairPintRange"
        type="range"
        aria-label="Fair pint price"
        aria-valuetext={`${figure}, loading prices`}
        min={300}
        max={800}
        step={10}
        defaultValue={prelude ? 550 : undefined}
        {...slider}
      />
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
        {locationOff ? "Location is off" : "Use my location"}
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {pending ? <p role="status">Drawing your night…</p> : null}
      <button
        type="button"
        className={buttonVariants({})}
        aria-busy={pending}
        onClick={onDraw}
        disabled={drawDisabled}
      >
        Draw my night in {area}
      </button>
      {reason ? <p className="fairPintReason">{reason}</p> : null}
      <button
        type="button"
        className={`${buttonVariants({ variant: "ghost", size: "icon" })} fairPintClose`}
        aria-label="Close"
        onClick={onClose}
      >
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}
