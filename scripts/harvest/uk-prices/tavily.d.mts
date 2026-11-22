import type { SnapshotPub, TavilyLaneResult, TavilyLaneTarget } from "./tavilyLane.mjs";

export function buildQueue(
  ordered: SnapshotPub[],
  options: {
    ledger: { pubs: Record<string, Partial<TavilyLaneResult>> };
    pubLimit: number;
    hostCounts: Map<string, number>;
  },
): { queue: TavilyLaneTarget[]; chainsDelegated: number };

export function persistTavilyRows(
  files: string[],
  targets: TavilyLaneTarget[],
  outcomes: TavilyLaneResult[],
  observedAt: string,
): number;
