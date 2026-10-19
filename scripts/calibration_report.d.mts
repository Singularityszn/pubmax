export type CalibrationRow = { probability: number; correct: boolean };

export type CalibrationBin = {
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number | null;
  accuracy: number | null;
};

export type ThresholdRow = {
  threshold: number;
  count: number;
  accuracy: number | null;
  wilsonLower: number | null;
  share: number | null;
  recall: number | null;
};

export type CalibrationDecision = {
  name: string;
  kind: "choice" | "noul";
  current: number | null;
  rows: Array<CalibrationRow & { id: string }>;
  thresholdRows?: Array<{ id: string; score: number; correct: boolean; shouldClear?: boolean }>;
  /** "below" for a refusal floor, which clears a score at or below it. */
  direction?: ThresholdDirection;
};

export type ThresholdDirection = "above" | "below";

export declare function binIndex(probability: number): number;
export declare function calibrationBins(rows: readonly CalibrationRow[]): CalibrationBin[];
export declare function expectedCalibrationError(rows: readonly CalibrationRow[]): number | null;
export declare function wilsonLowerBound(successes: number, trials: number): number | null;
export declare function thresholdTable(
  rows: ReadonlyArray<{ score: number; correct: boolean; shouldClear?: boolean }>,
  thresholds?: readonly number[],
  direction?: ThresholdDirection,
): ThresholdRow[];
export declare function recommendThreshold(
  table: readonly ThresholdRow[],
  target?: number,
  direction?: ThresholdDirection,
): ThresholdRow | null;
export declare function recommendForDecision(decision: CalibrationDecision): ThresholdRow | null;
export declare function enoughToAct(pick: ThresholdRow | null): boolean;
export declare function loadDecisions(): CalibrationDecision[];
export declare function renderReport(decisions: readonly CalibrationDecision[], date: string): string;
