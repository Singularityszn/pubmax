/** Deploy revision used to cache-bust map venue packs (`?v=` on `/data/*`). */
export const MAP_DATA_REVISION =
  process.env.NEXT_PUBLIC_SW_VERSION?.trim() ||
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error("A deploy revision is required for production map data");
      })()
    : "local");

// The revision match is a production cache-busting guard. `next dev` serves
// whatever packs public/data holds, committed `local`, restamped with HEAD or a
// mix, so outside production every pack is accepted.
export const EXPECTED_MAP_DATA_REVISION =
  process.env.NODE_ENV === "production" && MAP_DATA_REVISION !== "local"
    ? MAP_DATA_REVISION
    : undefined;

// --- revision skew -----------------------------------------------------------
//
// Around a deploy the HTML (and the revision baked into it) and the packs on
// the server can disagree for a while: old HTML or worker with new packs, or
// the reverse, or a build that skipped the pack restamp. Refusing every pack
// then left the map at ZERO pins with nothing anybody could see: no
// `pubmax:first-pins`, the reveal coordinator burning its ceiling on every
// load. The loader now adopts the revision the server actually serves when a
// cache-bypassed read still disagrees (the pack is internally consistent, so
// its own revision is the one its shards must match), and every adoption or
// refusal is reported through the first-party client error reporter, so a
// skewed deploy is a log line rather than an empty map.

/** Window event the client error reporter turns into one report. */
export const MAP_DATA_REVISION_SKEW_EVENT = "pubmax:map-data-revision-skew";

/** Which map pack disagreed. A closed set, never a URL. */
type MapDataRevisionSkewAsset = "manifest" | "shard" | "index";

/** What the loader did about it: painted the served pack, or refused it. */
type MapDataRevisionSkewOutcome = "adopted" | "refused";

export type MapDataRevisionSkew = {
  asset: MapDataRevisionSkewAsset;
  outcome: MapDataRevisionSkewOutcome;
  expected: string | undefined;
  served: unknown;
};

/** The error class the report carries, so the log line is greppable. */
export const MAP_DATA_REVISION_SKEW_ERROR_NAME = "MapDataRevisionSkew";

// A deploy revision is a git SHA; the reporter redacts 32+ hex characters as a
// secret, so a short prefix is what survives, and anything else is named.
function revisionLabel(value: unknown): string {
  if (value === undefined || value === null) return "none";
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(value)) return "other";
  return value.slice(0, 12);
}

/** The one sentence a skew report says. Pure, so the fence can read it. */
export function mapDataRevisionSkewMessage(skew: MapDataRevisionSkew): string {
  return `map ${skew.asset} revision skew: expected ${revisionLabel(skew.expected)}, served ${revisionLabel(skew.served)}, ${skew.outcome}`;
}

const reportedSkews = new Set<string>();
// Held until the reporter drains them, so a skew found before the reporter's
// effect attached is still reported rather than dropped.
let pendingSkewMessages: string[] = [];

/**
 * Announce one skew to the client error reporter. Once per message per page,
 * because every shard of one skewed deploy says the same thing.
 */
export function reportMapDataRevisionSkew(skew: MapDataRevisionSkew): void {
  const message = mapDataRevisionSkewMessage(skew);
  if (reportedSkews.has(message)) return;
  reportedSkews.add(message);
  pendingSkewMessages.push(message);
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    window.dispatchEvent(new Event(MAP_DATA_REVISION_SKEW_EVENT));
  } catch {
    // Reporting is best effort and may never break the map read.
  }
}

/** Every skew message not yet handed to the reporter, oldest first. */
export function drainMapDataRevisionSkews(): string[] {
  const drained = pendingSkewMessages;
  pendingSkewMessages = [];
  return drained;
}
