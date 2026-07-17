export type PlanningConfidenceLevel = "high" | "medium" | "low";

export type PlanningEvidenceSource = {
  kind: "venue_dataset" | "night_area_review" | "night_signal";
  label: string;
  asOf?: string | null;
};

export type PlanningConfidence = {
  level: PlanningConfidenceLevel;
  score: number;
  routeReady: boolean;
  missingEvidence: string[];
  warnings: string[];
  provenance: PlanningEvidenceSource[];
};

export type PlanBudgetSummary = {
  currency: "GBP";
  limitPence: number | null;
  estimatedPerPersonPence: number | null;
  estimatedCrewPence: number | null;
  withinLimit: boolean | null;
  basis: "one-recorded-pint-per-stop";
};

export type PlanRouteTotals = {
  stopCount: number;
  straightLineWalkingKm: number;
  estimatedWalkingMinutes: number;
  /** Route geometry is straight-line; pavement routing is intentionally not implied. */
  distanceBasis: "straight-line";
};

export type PlanEndingOption = {
  id: string;
  label: string;
  detail: string;
  walkingMinutes?: number;
  priceImpactPence?: number | null;
  closingConfidence?: "confirmed" | "listed" | "estimated" | "unknown";
  href?: string;
  provenance: PlanningEvidenceSource[];
};

export type PlanEndingRecommendation = {
  kind: "food" | "get_home" | "keep_going";
  label: string;
  reason: string;
  preselected: boolean;
  requiresConfirmation: true;
  confidence: PlanningConfidenceLevel;
  warnings: string[];
  options: PlanEndingOption[];
};
