import "server-only";

// WHO MAY SEE "I'M HERE". A presence row names a person and the pub they are
// in right now, so it is live location. It is shown only to that person's
// mates: a verified Social account (signed in, a claimed handle, the adult
// check passed, not suspended) that is a mutual follow of the person, with no
// block either way. A follower alone, someone the person follows alone, a
// stranger and a signed-out reader see none of it. The viewer always sees
// their own row. The seeded demo layer (provenance "demo", keyless only) names
// nobody real, so it is not filtered here.
//
// The route (app/api/presence/route.ts) resolves the viewer through
// requireVerifiedSocialActor; this module only decides which rows that viewer
// may read.

import { followStore } from "@/lib/followStore";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import type { PresenceDTO } from "@/lib/presence";
import { isLiveMutual, type MutualViewer } from "@/lib/socialMutual.server";

export type PresenceAudienceDependencies = {
  listMutuals(handle: string): Promise<string[]>;
  /** True only when the pair is still mutual and neither side blocks the other. */
  isLiveMutual(viewer: MutualViewer, handle: string): Promise<boolean>;
};

const defaultDependencies = (): PresenceAudienceDependencies => ({
  listMutuals: (handle) => followStore().listMutuals(handle),
  isLiveMutual,
});

/** The demo rows anyone may see: seeded, keyless-only, naming nobody real. */
export function demoPresenceOnly(rows: readonly PresenceDTO[]): PresenceDTO[] {
  return rows.filter((row) => row.provenance === "demo");
}

/**
 * The rows a verified viewer may read: their own, their live mates', and the
 * seeded demo layer. Order is kept. Each person's live-mate answer is asked
 * once per read.
 */
export async function presenceVisibleToViewer(
  viewer: MutualViewer,
  rows: readonly PresenceDTO[],
  dependencies: Partial<PresenceAudienceDependencies> = {},
): Promise<PresenceDTO[]> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const self = normalizeViewerHandle(viewer.handle);
  const real = rows.filter((row) => row.provenance !== "demo");
  const mutuals =
    real.some((row) => normalizeViewerHandle(row.handle) !== self)
      ? new Set((await deps.listMutuals(viewer.handle)).map(normalizeViewerHandle).filter(Boolean))
      : new Set<string>();

  const verdicts = new Map<string, Promise<boolean>>();
  const mayRead = (handle: string): Promise<boolean> => {
    if (handle && handle === self) return Promise.resolve(true);
    if (!handle || !mutuals.has(handle)) return Promise.resolve(false);
    let verdict = verdicts.get(handle);
    if (!verdict) {
      verdict = deps.isLiveMutual(viewer, handle).catch(() => false);
      verdicts.set(handle, verdict);
    }
    return verdict;
  };

  const allowed = await Promise.all(
    rows.map((row) =>
      row.provenance === "demo" ? Promise.resolve(true) : mayRead(normalizeViewerHandle(row.handle)),
    ),
  );
  return rows.filter((_, index) => allowed[index]);
}
