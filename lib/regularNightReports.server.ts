import "server-only";

// The two server reads a regular night report needs beside its row: the pub's
// name, and the reporter's CURRENT handle. A handle is read at answer time,
// never stamped on the row, so a rename shows the new one and an old handle is
// never printed beside a report.

import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";
import {
  isLiveRegularNightReport,
  type PublicRegularNightReport,
  type RegularNightReport,
} from "@/lib/regularNightReports";
import { lookupUkBasePub } from "@/lib/ukBaseIndex";
import { isUkBaseId } from "@/lib/ukBasePubs";
import { resolveStoredVenue } from "@/lib/venueIndex";

async function venueNameFor(venueId: string): Promise<string | null> {
  try {
    if (isUkBaseId(venueId)) {
      const lookup = await lookupUkBasePub(venueId);
      return lookup.status === "ready" ? lookup.pub.name : null;
    }
    return (await resolveStoredVenue(venueId))?.name ?? null;
  } catch {
    return null;
  }
}

/** One lookup per pub however many rows name it. */
export function venueNameReader(): (venueId: string) => Promise<string | null> {
  const names = new Map<string, Promise<string | null>>();
  return (venueId) => {
    let name = names.get(venueId);
    if (!name) {
      name = venueNameFor(venueId);
      names.set(venueId, name);
    }
    return name;
  };
}

async function handleFor(userId: string): Promise<string | null> {
  try {
    return await profileStore().getHandleByUserId(userId);
  } catch {
    return null;
  }
}

/**
 * The handles the public-withdrawal boundary lets a stranger read, or null when
 * the boundary cannot answer. A suspended Social account or an auth ban
 * withdraws every handle the account has worn (lib/accountPublicAccess.server.ts),
 * and a read that cannot ask is a refusal, never a pass (review finding 7, PR 2402).
 */
async function publicHandles(handles: ReadonlyArray<string | null>): Promise<ReadonlySet<string> | null> {
  const named = handles.filter((handle): handle is string => Boolean(handle));
  if (named.length === 0) return new Set();
  try {
    const hidden = await withdrawnHandles(named);
    return new Set(named.map((handle) => normalizeHandle(handle)).filter((key) => key && !hidden.has(key)));
  } catch {
    return null;
  }
}

/**
 * The public projection. No account id and no photo key leave here. An open
 * row carries the reporter's handle; a confirmed one carries none, because a
 * person has checked it. A row with no handle to show while open (the reporter
 * gave theirs up, or the account is withdrawn from public view, or the
 * withdrawal check cannot answer) is dropped rather than printed as nobody's.
 */
export async function publicRegularNightReports(
  reports: readonly RegularNightReport[],
  now: number,
  viewerUserId: string | null = null,
): Promise<PublicRegularNightReport[]> {
  const name = venueNameReader();
  const live = reports.filter((row) => isLiveRegularNightReport(row, now));
  const reporters = [...new Set(live.filter((row) => row.status === "open").map((row) => row.reporterUserId))];
  const handleByReporter = new Map(
    await Promise.all(reporters.map(async (userId) => [userId, await handleFor(userId)] as const)),
  );
  const visible = await publicHandles([...handleByReporter.values()]);
  const out = await Promise.all(
    live.map(async (row): Promise<PublicRegularNightReport | null> => {
      let handle: string | null = null;
      if (row.status === "open") {
        handle = handleByReporter.get(row.reporterUserId) ?? null;
        if (!handle || !visible?.has(normalizeHandle(handle))) return null;
      }
      return {
        id: row.id,
        venueId: row.venueId,
        venueName: await name(row.venueId),
        kind: row.kind,
        weekday: row.weekday,
        startTime: row.startTime,
        note: row.note,
        status: row.status === "confirmed" ? "confirmed" : "open",
        lastSeenAt: row.lastSeenAt,
        expiresAt: row.expiresAt,
        handle,
        // Only a verified caller learns which rows are their own, and only
        // about themselves: the account id itself never leaves.
        ...(viewerUserId ? { own: row.reporterUserId === viewerUserId } : {}),
      };
    }),
  );
  return out.filter((row): row is PublicRegularNightReport => row !== null);
}
