import "server-only";

// The owner's mint for a borough bingo share link (launch review D8). Kept
// apart from the token module so the share page and its card, which only
// verify a token, never import a read of the Authorization header
// (lib/routerCacheFence.mjs). Only the API route imports this file.

import { callerUserId } from "@/lib/authServer";
import { boroughBingoMark, buildBoroughBingo, type BoroughBingoMark } from "@/lib/boroughBingo";
import { boroughBingoSharePath, mintBoroughBingoShare } from "@/lib/boroughBingoShare.server";
import { LONDON_BOROUGH_NAMES } from "@/lib/londonBoroughNames.mjs";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";
import { resolveStoredVenue } from "@/lib/venueIndex";

export type BoroughBingoMintResult =
  | { ok: true; path: string; mark: BoroughBingoMark }
  | { ok: false; status: 403 | 404 | 409 | 503; code: string; error: string };

export type BoroughBingoMintDeps = {
  verifyCaller(request: Request): Promise<string | null>;
  profile(handle: string): Promise<{ userId: string | null; tombstoned: boolean } | null>;
  /** Every venue the owner has a visible Pint Drop at, read as the owner. */
  venueIds(handle: string): Promise<string[]>;
  borough(venueId: string): Promise<string | null>;
  now(): number;
};

function defaultDeps(): BoroughBingoMintDeps {
  return {
    verifyCaller: callerUserId,
    async profile(handle) {
      const profile = await profileStore().getByHandle(handle);
      return profile ? { userId: profile.userId?.trim() || null, tombstoned: Boolean(profile.tombstonedAt) } : null;
    },
    venueIds: (handle) => pintDropsStore().listVisibleAuthorVenueIds(handle, { handle }),
    async borough(venueId) {
      const venue = await resolveStoredVenue(venueId);
      const name = venue?.borough || null;
      return name && LONDON_BOROUGH_NAMES.includes(name) ? name : null;
    },
    now: () => Date.now(),
  };
}

/**
 * The owner's "Share your card" tap. Owner only: the bearer must be the
 * account that owns the handle. The count is the server's own, from the same
 * geography the passport stamps, never a number the client sends.
 */
export async function mintOwnBoroughBingoShare(
  request: Request,
  rawHandle: string,
  deps: BoroughBingoMintDeps = defaultDeps(),
): Promise<BoroughBingoMintResult> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return { ok: false, status: 404, code: "NOT_FOUND", error: "No profile with that handle." };
  let caller: string | null;
  let profile: Awaited<ReturnType<BoroughBingoMintDeps["profile"]>>;
  try {
    [caller, profile] = await Promise.all([deps.verifyCaller(request).catch(() => null), deps.profile(handle)]);
  } catch {
    return { ok: false, status: 503, code: "STORE_UNAVAILABLE", error: "This is unavailable right now." };
  }
  if (!profile || profile.tombstoned) return { ok: false, status: 404, code: "NOT_FOUND", error: "No profile with that handle." };
  if (!caller || !profile.userId || caller !== profile.userId) {
    return { ok: false, status: 403, code: "OWNER_ONLY", error: "Only the owner sees this." };
  }
  let boroughs: string[];
  try {
    const ids = [...new Set(await deps.venueIds(handle))];
    boroughs = (await Promise.all(ids.map((id) => deps.borough(id).catch(() => null)))).flatMap((name) =>
      name ? [name] : [],
    );
  } catch {
    return { ok: false, status: 503, code: "STORE_UNAVAILABLE", error: "This is unavailable right now." };
  }
  const mark = boroughBingoMark(buildBoroughBingo(boroughs).filled);
  if (!mark) return { ok: false, status: 409, code: "NO_MARK_YET", error: "Fill 11 squares first." };
  try {
    return { ok: true, path: boroughBingoSharePath(handle, mintBoroughBingoShare(handle, mark, deps.now())), mark };
  } catch {
    return { ok: false, status: 503, code: "SHARE_UNAVAILABLE", error: "Sharing is unavailable right now." };
  }
}
