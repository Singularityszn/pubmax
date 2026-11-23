export type HarnessCluster = {
  /** The resolved psql binary. */
  psql: string;
  /** The TCP port on 127.0.0.1 that this cluster's own postmaster holds. */
  port: number;
  dataDir: string;
  /** Stops the cluster, removes its data directory and gives back its host slot. */
  stop(): void;
};

export type StartHarnessClusterOptions = {
  /** Names the data directory and the host slot, so a stray cluster says whose it is. */
  label?: string;
  maxConnections?: number;
};

export declare function startHarnessCluster(
  options?: StartHarnessClusterOptions,
): Promise<HarnessCluster>;

export declare function pickPort(): Promise<number>;
