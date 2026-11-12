// "People you may know": the mates of your mates, and nobody else.
//
// A PURE LEAF. The server read (lib/peopleYouMayKnow.server.ts) hands it the
// follow graph it read, and the panel prints its words. A suggestion is only
// ever a person a mate of yours has added back, and the line under it names
// the mates you share. No score, no guessed link and no invented count: the
// one number it may print is how many more of your lot are mates with them.

import { displayHandle } from "@/lib/handleDisplay";
import { normalizeHandle } from "@/lib/profiles";

/** At most this many people are suggested at once. */
export const MAY_KNOW_MAX = 6;

/** How many of the viewer's mates are read for their own lot. */
export const MAY_KNOW_MATES_READ = 30;

export type MayKnowCandidate = {
  handle: string;
  /** The viewer's mates who are also mates with this person, sorted. */
  via: string[];
};

/**
 * Rank the mates of the viewer's mates. Leaves out the viewer, the viewer's
 * own mates and anybody the viewer already follows. More shared mates first,
 * then by handle so the order is stable.
 */
export function rankMayKnow(input: {
  viewer: string;
  mates: readonly string[];
  matesOfMates: ReadonlyMap<string, readonly string[]>;
  viewerFollowing: readonly string[];
}): MayKnowCandidate[] {
  const viewer = normalizeHandle(input.viewer);
  const mates = new Set(input.mates.map((handle) => normalizeHandle(handle)).filter(Boolean));
  const skip = new Set([viewer, ...mates, ...input.viewerFollowing.map((handle) => normalizeHandle(handle))]);
  const via = new Map<string, Set<string>>();
  for (const mate of mates) {
    for (const raw of input.matesOfMates.get(mate) ?? []) {
      const handle = normalizeHandle(raw);
      if (!handle || skip.has(handle)) continue;
      const shared = via.get(handle) ?? new Set<string>();
      shared.add(mate);
      via.set(handle, shared);
    }
  }
  return [...via.entries()]
    .map(([handle, shared]) => ({ handle, via: [...shared].sort() }))
    .sort((a, b) => b.via.length - a.via.length || a.handle.localeCompare(b.handle));
}

/** The panel's words, in one place so the voice fences read them. */
export const MAY_KNOW_COPY = {
  title: "People you may know",
  lead: "Mates of your mates. Add them, and once they add you back you're each other's lot.",
} as const;

/** "Mates with @sam", "Mates with @sam and @jo", "Mates with @sam, @jo and 2 more of your lot". */
export function mayKnowLine(via: readonly string[]): string {
  const named = via.slice(0, 2).map((handle) => displayHandle(handle));
  const more = via.length - named.length;
  if (named.length === 0) return "";
  if (more > 0) return `Mates with ${named.join(", ")} and ${more} more of your lot`;
  return `Mates with ${named.join(" and ")}`;
}
