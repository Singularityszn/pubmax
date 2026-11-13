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

export async function presenceHandlesForViewer(
  viewer: MutualViewer,
  dependencies: Partial<PresenceAudienceDependencies> = {},
): Promise<string[]> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const self = normalizeViewerHandle(viewer.handle);
  if (!self) return [];
  const mutuals = [...new Set((await deps.listMutuals(viewer.handle)).map(normalizeViewerHandle))]
    .filter((handle) => handle && handle !== self);
  const allowed = await Promise.all(
    mutuals.map((handle) => deps.isLiveMutual(viewer, handle).catch(() => false)),
  );
  return [self, ...mutuals.filter((_, index) => allowed[index])];
}
