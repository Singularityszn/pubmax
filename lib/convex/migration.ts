import { createHash } from "node:crypto";

export type MigrationBatchStatus =
  | "prepared"
  | "running"
  | "shadowing"
  | "verified"
  | "cut_over"
  | "rolled_back"
  | "failed";

const TRANSITIONS: Readonly<Record<MigrationBatchStatus, readonly MigrationBatchStatus[]>> = {
  prepared: ["running", "rolled_back", "failed"],
  running: ["shadowing", "rolled_back", "failed"],
  shadowing: ["verified", "rolled_back", "failed"],
  verified: ["cut_over", "rolled_back", "failed"],
  cut_over: ["rolled_back", "failed"],
  rolled_back: [],
  failed: ["rolled_back"],
};

export function canTransitionMigration(
  from: MigrationBatchStatus,
  to: MigrationBatchStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !["_id", "_creationTime", "created_at", "updated_at"].includes(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function shadowRecordHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}
