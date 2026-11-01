// Which precomputed patch a /today reader's daytime modules answer from. A
// leaf of its own so the client bundle takes this lookup and none of the
// server-side builders in ./todayDaytime.ts.

import { CENTRAL_PATCH, resolveNightPatch } from "@/lib/nightPatches";

/**
 * The reader's own patch when the index holds it, else central London, else
 * nothing. Never an id the index lacks.
 */
export function todayPatchModule<M>(
  patchId: string | null,
  index: Readonly<Record<string, M>>,
): M | null {
  if (patchId && resolveNightPatch(patchId) && index[patchId]) return index[patchId] ?? null;
  return index[CENTRAL_PATCH.id] ?? null;
}
