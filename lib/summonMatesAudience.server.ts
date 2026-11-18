import "server-only";

import { followStore } from "@/lib/followStore";
import { normalizeViewerHandle } from "@/lib/pintDrops";
import { eitherMutes, isUnmutedMate, type MateViewer } from "@/lib/socialMutual.server";

export type SummonMateDependencies = {
  listMutuals(handle: string): Promise<string[]>;
  eitherMutes(viewer: MateViewer, handle: string): Promise<boolean>;
};

const SUMMON_MUTUALS_CHECKED = 60;

/** The live mutual mates this viewer may summon, sorted by handle. */
export async function summonableMates(
  viewer: MateViewer,
  dependencies: Partial<SummonMateDependencies> = {},
): Promise<string[]> {
  const deps: SummonMateDependencies = {
    listMutuals: (handle) => followStore().listMutuals(handle),
    eitherMutes,
    ...dependencies,
  };
  const self = normalizeViewerHandle(viewer.handle);
  const mutuals = [
    ...new Set((await deps.listMutuals(viewer.handle)).map(normalizeViewerHandle)),
  ]
    .filter((handle) => handle && handle !== self)
    .sort()
    .slice(0, SUMMON_MUTUALS_CHECKED);
  const allowed = await Promise.all(mutuals.map((handle) => isUnmutedMate(viewer, handle, deps.eitherMutes)));
  return mutuals.filter((_, index) => allowed[index]);
}
