export declare const COMMITTED_BUNDLED_DATA_PATHS: readonly string[];

export declare function restoreCommittedBundledData(cwd?: string): boolean;

export declare function shouldRestoreBundledDataAfterTrackedOutputs(
  trackedOutputs: string[],
): boolean;
