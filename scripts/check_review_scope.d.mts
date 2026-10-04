/** One stderr line per failing check, printed after the JSON report. */
export const REVIEW_SCOPE_HINTS: Readonly<
  Record<"generated" | "skill-pack" | "pipeline-data", string>
>;

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

export function normalizeReviewPath(value: unknown): string;
export function classifyReviewFile(value: unknown): {
  path: string;
  category: ReviewCategory;
  domain: string | null;
};
export function summarizeReviewScope(values: readonly unknown[]): ReviewScopeReport;
export function changedFilesFromGit(
  base: string,
  head: string,
  cwd: string,
): string[];
/** Subject prefix of a commit the no-mistakes pipeline wrote. */
export const PIPELINE_COMMIT_SUBJECT: RegExp;

export type BranchCommit = { sha: string; subject: string; paths: string[] };

/** Bundled-data paths that no-mistakes pipeline commits touched. */
export function pipelineDataChurn(
  commits: readonly BranchCommit[],
): Array<{ sha: string; path: string }>;
export function commitsFromGit(base: string, head: string, cwd: string): BranchCommit[];
export function runReviewScopeCli(
  argv?: string[],
  cwd?: string,
): ReviewScopeReport & { pipelineChurn: Array<{ sha: string; path: string }> };
