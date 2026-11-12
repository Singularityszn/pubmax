import "server-only";

// The owner's mint for a Been card share link. Kept apart from the token
// module so the share page and its card, which only verify a token, never
// import a read of the Authorization header (lib/routerCacheFence.mjs). Only
// the API route imports this file.

import { callerUserId } from "@/lib/authServer";
import { BEEN_CARD_UNLOCK, beenCardUnlocked, cheapestBeenCardDrop, type BeenCardDrop } from "@/lib/beenCard";
import { beenCardSharePath, mintBeenCardShare } from "@/lib/beenCardShare.server";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { readPassportBeen } from "@/lib/profilePassport.server";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";

export type BeenCardMintResult =
  | { ok: true; path: string; pubs: number }
  | { ok: false; status: 403 | 404 | 409 | 503; code: string; error: string };

export type BeenCardMintDeps = {
  verifyCaller(request: Request): Promise<string | null>;
  profile(handle: string): Promise<{ userId: string | null; tombstoned: boolean } | null>;
  /** The owner's own Been count, every source folded in, or null when a source failed. */
  beenCount(request: Request, handle: string): Promise<number | null>;
  /** The owner's own visible drops, read as the owner. */
  ownDrops(handle: string): Promise<BeenCardDrop[]>;
  now(): number;
};

function defaultDeps(): BeenCardMintDeps {
  return {
    verifyCaller: callerUserId,
    async profile(handle) {
      const profile = await profileStore().getByHandle(handle);
      return profile ? { userId: profile.userId?.trim() || null, tombstoned: Boolean(profile.tombstonedAt) } : null;
    },
    async beenCount(request, handle) {
      const read = await readPassportBeen(request, handle);
      if (!read.ok || read.body.access !== "full" || read.body.status !== "ready") return null;
      return read.body.count;
    },
    ownDrops: (handle) => pintDropsStore().listVisible(undefined, { handle }, handle),
    now: () => Date.now(),
  };
}

const UNAVAILABLE = { ok: false, status: 503, code: "STORE_UNAVAILABLE", error: "This is unavailable right now." } as const;
const NOT_FOUND = { ok: false, status: 404, code: "NOT_FOUND", error: "No profile with that handle." } as const;

/**
 * The owner's "Share your Been card" tap. Owner only: the bearer must be the
 * account that owns the handle. The count and the pint are the server's own,
 * never a number the client sends.
 */
export async function mintOwnBeenCardShare(
  request: Request,
  rawHandle: string,
  deps: BeenCardMintDeps = defaultDeps(),
): Promise<BeenCardMintResult> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return NOT_FOUND;
  let caller: string | null;
  let profile: Awaited<ReturnType<BeenCardMintDeps["profile"]>>;
  try {
    [caller, profile] = await Promise.all([deps.verifyCaller(request).catch(() => null), deps.profile(handle)]);
  } catch {
    return UNAVAILABLE;
  }
  if (!profile || profile.tombstoned) return NOT_FOUND;
  if (!caller || !profile.userId || caller !== profile.userId) {
    return { ok: false, status: 403, code: "OWNER_ONLY", error: "Only the owner sees this." };
  }
  let pubs: number | null;
  let drops: BeenCardDrop[];
  try {
    [pubs, drops] = await Promise.all([deps.beenCount(request, handle), deps.ownDrops(handle)]);
  } catch {
    return UNAVAILABLE;
  }
  // A list read with a failed source would sign a count that is short.
  if (pubs === null) return UNAVAILABLE;
  if (!beenCardUnlocked(pubs)) {
    return { ok: false, status: 409, code: "NOT_UNLOCKED", error: `Add ${BEEN_CARD_UNLOCK} pubs to your Been list first.` };
  }
  const cheapest = cheapestBeenCardDrop(drops, handle);
  try {
    const token = mintBeenCardShare(handle, pubs, cheapest?.id ?? null, deps.now());
    return { ok: true, path: beenCardSharePath(handle, token), pubs };
  } catch {
    return { ok: false, status: 503, code: "SHARE_UNAVAILABLE", error: "Sharing is unavailable right now." };
  }
}
