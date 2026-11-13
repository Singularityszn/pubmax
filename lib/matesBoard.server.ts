import "server-only";

// WHO IS ON THE MATES' BOARD. The reader and their mates, each with their own
// points from lib/points.server.ts.
//
// A mate here is a live mutual follow with no block or mute either way, asked
// through the one check (isUnmutedMate in lib/socialMutual.server.ts). A
// private account lets its mates read the rest of its profile, and the board
// reaches mates alone, so a private mate stays on it. A handle moderation
// withdrew from public view never shows. A relationship or withdrawal read that
// fails makes the whole board unavailable rather than quietly short.

import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { followStore } from "@/lib/followStore";
import {
  MATES_BOARD_MAX_MATES,
  type MatesBoardAnswer,
  type MatesBoardRow,
} from "@/lib/matesBoard";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import type { PointsStanding } from "@/lib/points";
import { readPointsStanding } from "@/lib/points.server";
import { profileStore, type ProfileRecord } from "@/lib/profileStore";
import { isUnmutedMate, type MateViewer } from "@/lib/socialMutual.server";

/** How many people's points are read at once. */
const STANDING_READS_AT_ONCE = 6;

export type MatesBoardDependencies = {
  listMutuals(handle: string): Promise<string[]>;
  /** Live mutual, no block and no mute either way. Throws when it cannot tell. */
  isMate(viewer: MateViewer, handle: string): Promise<boolean>;
  /** The handles moderation withdrew from public view. Throws when it cannot tell. */
  withdrawn(handles: readonly string[]): Promise<ReadonlySet<string>>;
  profile(handle: string): Promise<ProfileRecord | null>;
  standing(owner: ProfileRecord): Promise<PointsStanding>;
};

const defaultDependencies = (): MatesBoardDependencies => ({
  listMutuals: (handle) => followStore().listMutuals(handle),
  isMate: (viewer, handle) => isUnmutedMate(viewer, handle),
  withdrawn: withdrawnHandles,
  profile: (handle) => profileStore().getByHandle(handle),
  standing: readPointsStanding,
});

async function inTurns<T, R>(items: readonly T[], read: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await read(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(STANDING_READS_AT_ONCE, items.length) }, worker));
  return results;
}

export async function readMatesBoard(
  viewer: MateViewer,
  dependencies: Partial<MatesBoardDependencies> = {},
): Promise<MatesBoardAnswer> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const self = normalizeViewerHandle(viewer.handle);

  const candidates = [...new Set((await deps.listMutuals(viewer.handle)).map(normalizeViewerHandle))]
    .filter((handle) => handle && handle !== self)
    .sort();
  const checked = candidates.slice(0, MATES_BOARD_MAX_MATES);
  const allowed = await Promise.all(checked.map((handle) => deps.isMate(viewer, handle)));
  const mutual = checked.filter((_, index) => allowed[index]);
  const hidden = mutual.length ? await deps.withdrawn(mutual) : new Set<string>();
  const mates = mutual.filter((handle) => !hidden.has(handle));

  const people = (await Promise.all([self, ...mates].map((handle) => deps.profile(handle))))
    .filter((profile): profile is ProfileRecord => profile !== null);
  const standings = await inTurns(people, (profile) => deps.standing(profile));

  const rows: MatesBoardRow[] = people.map((profile, index) => {
    const standing = standings[index]!;
    const handle = normalizeViewerHandle(profile.handle);
    return {
      handle,
      self: handle === self,
      total: standing.total,
      level: standing.level,
    };
  });
  return {
    status: standings.some((standing) => standing.status === "degraded") ? "degraded" : "ready",
    capped: candidates.length > checked.length,
    rows,
  };
}
