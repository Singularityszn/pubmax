// The public shape of one row in a follow list (followers or following).
// Pure and browser-safe: routes project into it, clients read it, and the
// feed extracts handles from either this object or a legacy string.

import { normalizeHandle } from "@/lib/profiles";

export type FollowListEntry = {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

/** One row from a follow-list API body, or nothing if it carries no handle. */
export function parseFollowListEntry(row: unknown): FollowListEntry | null {
  if (typeof row === "string") {
    const handle = normalizeHandle(row);
    return handle ? { handle } : null;
  }
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const handle = normalizeHandle(record.handle);
  if (!handle) return null;
  const entry: FollowListEntry = { handle };
  if (typeof record.displayName === "string" && record.displayName.trim()) {
    entry.displayName = record.displayName.trim();
  }
  if (typeof record.avatarUrl === "string" && record.avatarUrl.trim()) {
    entry.avatarUrl = record.avatarUrl.trim();
  }
  return entry;
}

/** Handles only, for callers that still think in sets (the feed lane, /lot). */
export function followListHandle(row: unknown): string {
  return parseFollowListEntry(row)?.handle ?? "";
}
