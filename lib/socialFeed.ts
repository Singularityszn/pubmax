// The Social Loop privacy choke point. ONE place decides which check-ins reach
// which surface, exactly like getPublishedRecapSource is the one gate for recap
// content (lib/nightMemoryStore.ts). Every surface that shows check-ins — the
// "Your lot" feed tab, the check-ins GET route, any future area/public read —
// goes through a function here. Nothing reads lib/checkInStore.ts directly to
// render, so "friends-only content never reaches a public query" is enforced in
// one tested place, not sprinkled across call sites.
//
// The rules:
//   • "Your lot" = the viewer's mates: mutual follows with no block either way,
//     the same audience "I'm here" presence uses (lib/presenceAudience.server.ts).
//     A friends-only check-in is visible to a viewer ONLY when its author is in
//     that set. A viewer with no handle (anonymous) sees none.
//   • The viewer's OWN check-ins are always in their "your lot" view (you can see
//     that you're out).
//   • Public/area reads return ONLY visibility === 'area' check-ins (the reserved
//     future opt-in). Friends-only rows can never fall through here — this is the
//     "no friends-only in a public query" guarantee, by construction.
//   • Everything is non-expired (2h TTL) — expiry is applied in the store reads
//     AND re-asserted here, so a caller can't widen the window.

import { activeCheckIns, type CheckIn } from "@/lib/checkIn";
import { checkInStore } from "@/lib/checkInStore";
import { presenceHandlesForViewer } from "@/lib/presenceAudience.server";
import { normalizeHandle } from "@/lib/profiles";
import type { MutualViewer } from "@/lib/socialMutual.server";

export async function ownCheckInsForHandle(
  handle: string,
  now: number = Date.now(),
): Promise<CheckIn[]> {
  const self = normalizeHandle(handle);
  if (!self) return [];
  const rows = await checkInStore().listByHandles([self], now);
  return activeCheckIns(rows.filter((row) => normalizeHandle(row.handle) === self), now);
}

/**
 * The check-ins visible to a verified `viewer` in their "Your lot" feed —
 * friends-only check-ins authored by a mate, plus the viewer's own, non-expired,
 * newest-first. An anonymous viewer (no handle) gets [].
 *
 * This is the ONLY path the "Your lot" surface uses to read check-ins. It never
 * returns a check-in whose author is not a mate (or the viewer), so a
 * friends-only post cannot leak to someone outside the two-party relationship.
 */
export async function visibleCheckInsForViewer(
  viewer: MutualViewer,
  now: number = Date.now(),
): Promise<CheckIn[]> {
  const audience = new Set((await presenceHandlesForViewer(viewer)).map(normalizeHandle));
  if (audience.size === 0) return [];

  const rows = await checkInStore().listByHandles([...audience], now);
  // Defence in depth: the store already scoped to these handles and non-expired,
  // but re-assert both here so this choke is correct even if a store changes.
  const scoped = rows.filter((c) => audience.has(normalizeHandle(c.handle)));
  return activeCheckIns(scoped, now);
}

/**
 * The check-ins on a PUBLIC / area surface: visibility === 'area' only,
 * non-expired, newest-first. Friends-only rows are never returned here — the
 * public-query guarantee. Today (friends-only default, no public opt-in shipped)
 * this is typically empty; it exists so the Nearby/London tabs have a single,
 * safe seam the moment the owner turns on area-public check-ins.
 */
export async function areaPublicCheckIns(
  now: number = Date.now(),
): Promise<CheckIn[]> {
  const rows = await checkInStore().listByVisibility("area", now);
  return activeCheckIns(rows, now);
}
