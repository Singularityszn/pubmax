export const MAX_REVIEW_FILES: number;
export const MAX_RUNTIME_DOMAINS: number;

export type ReviewCategory =
  | "source"
  | "migration"
  | "generated"
  | "regenerated"
  | "evidence"
  | "test"
  | "config"
  | "docs"
  | "skill-pack"
  | "other";

/** A generated lane that may ride the review that produced it. */
export type RegeneratedLane = {
  id: string;
  output: RegExp;
  inputs: RegExp[];
};

export const REGENERATED_LANES: readonly RegeneratedLane[];

export function explainedRegeneratedLanes(
  paths: readonly string[],
): RegeneratedLane[];

export type ReviewScopeReport = {
  fileCount: number;
  /** File count a person actually reviews: permitted generated output is out. */
  reviewFileCount: number;
  /** Lanes this diff produced, so their output was permitted rather than forbidden. */
  regeneratedLanes: string[];
  categories: Partial<Record<ReviewCategory, string[]>>;
  categoryCounts: Partial<Record<ReviewCategory, number>>;
  domains: string[];
  warnings: string[];
  forbidden: Array<{ category: ReviewCategory; path: string }>;
  ok: boolean;
};

/** Git status preserves the distinction between a deletion and a new path. */
export type ReviewChange = {
  path: string;
  status: string;
};

export function normalizeReviewPath(value: unknown): string;
export function classifyReviewFile(value: unknown, status?: string): {
  path: string;
  category: ReviewCategory;
  domain: string | null;
};
export function summarizeReviewScope(values: readonly unknown[]): ReviewScopeReport;
export function changedFilesFromGit(
  base: string,
  head: string,
  cwd: string,
): ReviewChange[];
export function runReviewScopeCli(
  argv?: string[],
  cwd?: string,
): ReviewScopeReport;
