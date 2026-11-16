import { Check } from "lucide-react";

import "./sheetStepProgress.css";

type SheetStepState = "upcoming" | "current" | "settled" | "skipped";

export type SheetStep = {
  label: string;
  state: SheetStepState;
};

export type SheetStepProgressProps = {
  /** One segment per step, in order. */
  steps: readonly SheetStep[];
  /** Accessible name for the rail. */
  label?: string;
  /** Visual accent token scope. */
  variant?: "plan" | "map";
  /**
   * On a phone the rail is bars only, with no numbered markers. For a sheet
   * that already states the step in words and has number choices of its own.
   */
  compact?: boolean;
  className?: string;
};

/**
 * Capsule progress rail: one segment per step, with `aria-current="step"` on the
 * active item in an ordered list. An answered step shows a check; a skipped one
 * keeps its number and says so in its label.
 */
export default function SheetStepProgress({
  steps,
  label = "Progress",
  variant = "plan",
  compact = false,
  className,
}: SheetStepProgressProps) {
  const classes = ["sheetStepProgress", `sheetStepProgress--${variant}`, compact ? "sheetStepProgress--compact" : null, className]
    .filter(Boolean)
    .join(" ");

  return (
    <ol
      className={classes}
      aria-label={label}
      style={{ ["--sheet-step-count" as string]: String(steps.length) }}
    >
      {steps.map((step, index) => (
        <li
          key={step.label}
          className="sheetStepProgress__segment"
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <span className="sheetStepProgress__marker" aria-hidden="true">
            {step.state === "settled" ? <Check size={14} /> : index + 1}
          </span>
          <span className="sheetStepProgress__label">
            {step.label}{step.state === "skipped" ? " skipped" : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}
