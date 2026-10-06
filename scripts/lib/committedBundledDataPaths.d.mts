export declare const COMMITTED_BUNDLED_DATA_PATHS: readonly string[];

export declare function isBundledDataFile(path: string): boolean;

export declare function untrackedBundledData(cwd?: string): Set<string> | null;

export declare function restoreCommittedBundledData(
  cwd?: string,
  options?: { untrackedBefore?: Set<string> | null },
): boolean;

export declare function shouldRestoreBundledDataAfterTrackedOutputs(
  trackedOutputs: string[],
): boolean;
