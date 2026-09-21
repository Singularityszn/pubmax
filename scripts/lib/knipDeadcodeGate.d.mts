export const ERROR_ISSUE_TYPES: ReadonlySet<string>;

export interface KnipFinding {
  type: string;
  file: string;
  name: string;
  line?: number;
  col?: number;
}

export interface KnipGateDecision {
  mode: "main" | "branch" | "base-unreadable";
  owned: KnipFinding[];
  inherited: KnipFinding[];
  exitCode: 0 | 1;
}

export function issueKey(issue: KnipFinding): string;

export function flattenKnipReport(report: unknown): KnipFinding[];

export function errorIssues(issues: readonly KnipFinding[]): KnipFinding[];

export function isMainlineGate(aheadCount: number): boolean;

export function decideKnipGate(input: {
  aheadCount: number;
  headIssues: readonly KnipFinding[];
  baseIssues?: readonly KnipFinding[];
  baseReadable: boolean;
}): KnipGateDecision;
