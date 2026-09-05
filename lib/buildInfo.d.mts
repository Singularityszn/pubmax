export type BuildCommitSource = "vercel-git" | "working-tree";

export declare const BUILD_COMMIT_SOURCES: Readonly<{
  vercelGit: "vercel-git";
  workingTree: "working-tree";
}>;

export interface BuildCommit {
  commitSha: string | null;
  commitShaSource: BuildCommitSource | null;
}

export interface BuildStamp extends BuildCommit {
  builtAt: string | null;
}

export declare function normalizeCommitSha(value: unknown): string | null;

export declare function normalizeCommitSource(value: unknown): BuildCommitSource | null;

export declare function normalizeBuildTime(value: unknown): string | null;

export declare function resolveBuildCommit(
  env?: Record<string, string | undefined>,
  workingTreeSha?: string | null,
): BuildCommit;

export declare function resolveBuildStamp(
  env?: Record<string, string | undefined>,
  options?: { workingTreeSha?: string | null; now?: Date },
): BuildStamp & { builtAt: string };

export declare function readBuildStamp(
  env?: Record<string, string | undefined>,
): BuildStamp;

export declare function deployStampBuildEnv(
  input?: { headSha?: string | null; dirty?: boolean },
): Record<string, string>;
