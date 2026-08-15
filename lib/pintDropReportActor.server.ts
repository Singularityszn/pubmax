// WHO reported a Pint Drop is decided HERE, by the server, and never by the
// caller.
//
// Reporting is unauthenticated public moderation, and two reports hide a drop
// (`REPORT_HIDE_THRESHOLD`). The counted identity used to be
// `hashActor(fields.actor)` - an arbitrary client string - so one person sent
// `actor:"a"` then `actor:"b"` and any drop on the site went dark. The comment
// beside it claimed two DIFFERENT actors were required; they were not.
//
// The counted identity is now the strongest thing the request itself proves:
// a verified account id when the caller brought one, otherwise the salted hash
// of the client IP alone. An IP can be changed, but it is not a free string the
// same client picks twice, and no client-supplied field reaches the counted
// axis. That is the whole distance between "two people objected" and "one
// person clicked twice".

import { callerUserId } from "@/lib/authServer";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";

/**
 * The identity a report is COUNTED under. Server-derived, always.
 */
export async function pintDropReportActorHash(request: Request): Promise<string> {
  let userId: string | null = null;
  try {
    userId = await callerUserId(request);
  } catch {
    // An identity lookup we could not run is not a caller we may trust with
    // their own id: fall through to the request's own facts.
    userId = null;
  }
  if (userId) return hashActor(`user:${userId}`);

  return hashActor(`ip:${hashIp(clientIp(request))}`);
}
