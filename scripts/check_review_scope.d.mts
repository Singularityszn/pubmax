/** One stderr line per failing check, printed after the JSON report. */
export const REVIEW_SCOPE_HINTS: Readonly<
  Record<"generated" | "skill-pack" | "ci-data" | "ci-flake", string>
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
/** Subject prefix of a no-mistakes CI-step fix commit. */
export const CI_FIX_COMMIT_SUBJECT: RegExp;

/** Known-flake specs another lane owns, which a CI repair may not edit. */
export const KNOWN_FLAKE_SPECS: readonly string[];

export type BranchCommit = { sha: string; subject: string; paths: string[] };

export type CiFixChurn = { sha: string; path: string; category: "ci-data" | "ci-flake" };

/** Bundled-data and known-flake paths that no-mistakes CI-step fix commits touched. */
export function ciFixChurn(commits: readonly BranchCommit[]): CiFixChurn[];
export function commitsFromGit(base: string, head: string, cwd: string): BranchCommit[];
/** Reads CI-step fix commits only when argv carries --ci-commits. */
export function runReviewScopeCli(
  argv?: string[],
  cwd?: string,
): ReviewScopeReport & { ciChurn: CiFixChurn[] };
