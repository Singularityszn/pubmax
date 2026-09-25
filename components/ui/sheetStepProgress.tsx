import { Check } from "lucide-react";

import "./sheetStepProgress.css";

export type SheetStepState = "upcoming" | "current" | "settled" | "skipped";

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
  className,
}: SheetStepProgressProps) {
  const classes = ["sheetStepProgress", `sheetStepProgress--${variant}`, className]
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
            {step.state === "settled" ? <Check size={13} /> : index + 1}
          </span>
          <span className="sheetStepProgress__label">
            {step.label}{step.state === "skipped" ? " skipped" : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}
