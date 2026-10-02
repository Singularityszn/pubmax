// Hand-written types for the plain-JS data-revision rule (allowJs is off, so
// tsc needs a declaration to typecheck the unit tests that import it). Keep in
// lockstep with lib/dataRevision.mjs.

export declare const WORKING_TREE_REVISION_LENGTH: number;
export declare const LOCAL_DATA_REVISION: string;
export declare const NO_DATA_REVISION_REFUSAL: string;

export declare function environmentDataRevision(
  env?: Record<string, string | undefined>,
): string | null;

export declare function revisionFromCommitSha(value: unknown): string | null;

export declare function readWorkingTreeCommitSha(cwd?: string): string | null;

export declare function readPackDataRevision(root?: string): string | null;

export declare function resolveDataRevision(
  env?: Record<string, string | undefined>,
  options?: { workingTreeSha?: string | null },
): string | null;

export declare function packBuildEnv(
  env?: Record<string, string | undefined>,
): Record<string, string | undefined>;

export declare function requireDataRevision(
  env?: Record<string, string | undefined>,
  options?: { workingTreeSha?: string | null; packRevision?: string | null },
): string;
