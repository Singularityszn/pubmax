import "server-only";

// The two server reads a regular night report needs beside its row: the pub's
// name, and the reporter's CURRENT handle. A handle is read at answer time,
// never stamped on the row, so a rename shows the new one and an old handle is
// never printed beside a report.

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
 * The public projection. No account id and no photo key leave here. An open
 * row carries the reporter's handle; a confirmed one carries none, because a
 * person has checked it. A row with no handle to show while open (the reporter
 * gave theirs up) is dropped rather than printed as nobody's.
 */
export async function publicRegularNightReports(
  reports: readonly RegularNightReport[],
  now: number,
  viewerUserId: string | null = null,
): Promise<PublicRegularNightReport[]> {
  const name = venueNameReader();
  const handles = new Map<string, Promise<string | null>>();
  const out = await Promise.all(
    reports
      .filter((row) => isLiveRegularNightReport(row, now))
      .map(async (row): Promise<PublicRegularNightReport | null> => {
        let handle: string | null = null;
        if (row.status === "open") {
          let pending = handles.get(row.reporterUserId);
          if (!pending) {
            pending = handleFor(row.reporterUserId);
            handles.set(row.reporterUserId, pending);
          }
          handle = await pending;
          if (!handle) return null;
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
