export declare function isPubmaxHarnessDataDir(dataDir: string): boolean;
export declare function postgresDataDirFromCommand(command: string): string | null;
export declare function stopHarnessCluster(dataDir: string): void;
export declare function sweepPubmaxHarnessOrphans(): void;
export declare function registerHarnessCluster(dataDir: string): void;
export declare function unregisterHarnessCluster(dataDir: string): void;
export declare function sysvSegmentsCreatedBy(
  pids: Iterable<number>,
): { id: string; nattch: number; segsz: number; cpid: number }[];
