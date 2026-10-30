// "Tell your lot": the owner's per-log consent to one mutuals-only Social card.
//
// A diary log and a ranking are private. When, and only when, the request
// carries `shareToLot: true`, the SERVER writes one friends-visibility post in
// the author's name through the ordinary posts store, so it is moderated,
// listed and deletable like any post. The client never writes the words and
// never names the author: the author is the verified Social actor of the
// session, and for a diary log that actor must be the same account the diary
// entry belongs to. A refusal at any step leaves the private log saved and
// answers `shared: false`; it never fails the log itself.

import "server-only";

import { log } from "@/lib/log";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSystemSocialPostCard, type SocialPostActor } from "@/lib/socialPostStore";
import { hashActor } from "@/lib/supabase";

/**
 * The consent flag as a body sent it: absent is "no", a boolean is itself,
 * anything else is a malformed request (null).
 */
export function readShareToLot(value: unknown): boolean | null {
  if (value === undefined) return false;
  return typeof value === "boolean" ? value : null;
}

/** "@sam was at The Lamb". The pub's name as the map lists it, never typed. */
export function tellYourLotVisitBody(handle: string, venueName: string): string {
  return `@${handle} was at ${venueName}`;
}

/** "@sam ranked The Lamb above The Harp", or "@sam ranked The Lamb" with nothing below it. */
export function tellYourLotRankBody(handle: string, venueName: string, belowVenueName: string | null): string {
  return belowVenueName
    ? `@${handle} ranked ${venueName} above ${belowVenueName}`
    : `@${handle} ranked ${venueName}`;
}

/**
 * The Social actor allowed to speak for `accountId`, or null. The session must
 * hold a verified Social account AND it must be the account that owns the log.
 */
export async function lotActorForAccount(
  request: Request,
  accountId: string,
): Promise<SocialPostActor | null> {
  try {
    const access = await requireVerifiedSocialActor(request);
    if (!access.ok || access.actor.accountId !== accountId) return null;
    return access.actor;
  } catch {
    return null;
  }
}

/** Write the one card. True when it was posted; false leaves the log private. */
export async function tellYourLot(
  actor: SocialPostActor,
  card: { body: string; venueId: string },
): Promise<boolean> {
  if (socialFreezeResponse()) return false;
  // The same budget as a post typed by hand, so consent is never a side door.
  const key = `social-post-create:${hashActor(actor.profileId)}`;
  if (await isLimited(key, key)) return false;
  try {
    await createSystemSocialPostCard(actor, card);
    return true;
  } catch (error) {
    log("warn", "tell_your_lot.post_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
