import "server-only";

import { readSocialFreeze } from "@/lib/opsFreeze";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";

/**
 * WHETHER A STRANGER MAY READ THE LONDON LANE RIGHT NOW. One answer for the
 * posts route, the photo door and the /social page, read at CALL time so a
 * flipped switch takes effect on the next request (the `lib/opsFreeze.ts`
 * doctrine).
 *
 * It closes under EITHER switch. `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` returns all
 * of Social to preview, so the lane goes with it. `PUBMAX_SOCIAL_FREEZE=social`
 * pauses posting and keeps reading open for signed-in readers, as the freeze
 * runbook promises; the lane is the widest read Social has, though, and an
 * incident is the moment to show strangers the least, so it pauses too.
 */
export function socialLondonLaneOpen(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return readTrustedHandoffFlag("socialFriendsLaunch", env) && !readSocialFreeze(env).frozen;
}
