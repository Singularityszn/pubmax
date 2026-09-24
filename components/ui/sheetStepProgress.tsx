import "./sheetStepProgress.css";

export type SheetStepSegmentState = "upcoming" | "current" | "settled";

/**
 * Resolve segment states for a linear step index (0-based).
 * Steps before `currentIndex` are settled; the current index is current; rest upcoming.
 */
export function sheetStepSegmentStates(
  stepCount: number,
  currentIndex: number,
): SheetStepSegmentState[] {
  const safeCount = Math.max(1, Math.min(5, stepCount));
  const safeIndex = Math.max(0, Math.min(safeCount - 1, currentIndex));
  return Array.from({ length: safeCount }, (_, index) => {
    if (index < safeIndex) return "settled";
    if (index === safeIndex) return "current";
    return "upcoming";
  });
}

export type SheetStepProgressProps = {
  /** Total segments (3 to 5 on plan flows; choose-area uses 3). */
  stepCount: number;
  /** Active step, 0-based. */
  currentIndex: number;
  /** Short labels for screen readers (one per segment). */
  stepLabels: readonly string[];
  /** Visual accent token scope. */
  variant?: "plan" | "map";
  className?: string;
};

/**
 * Capsule progress rail: one filled accent segment per step, with `aria-current="step"`
 * on the active item in an ordered list.
 */
export default function SheetStepProgress({
  stepCount,
  currentIndex,
  stepLabels,
  variant = "plan",
  className,
}: SheetStepProgressProps) {
  const count = Math.max(1, Math.min(5, stepCount));
  const states = sheetStepSegmentStates(count, currentIndex);
  const classes = ["sheetStepProgress", `sheetStepProgress--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <ol
      className={classes}
      aria-label="Progress"
      style={{ ["--sheet-step-count" as string]: String(count) }}
    >
      {states.map((state, index) => {
        const label = stepLabels[index] ?? `Step ${index + 1}`;
        return (
          <li
            key={`${index}-${label}`}
            className="sheetStepProgress__segment"
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="sheetStepProgress__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
