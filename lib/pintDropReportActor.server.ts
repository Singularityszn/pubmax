// WHO reported a Pint Drop is decided HERE, by the server, and never by the
// caller.
//
// Reporting is unauthenticated public moderation, and two reports hide a drop
// (`REPORT_HIDE_THRESHOLD`). The counted identity used to be
// `hashActor(fields.actor)` - an arbitrary client string - so one person sent
// `actor:"a"` then `actor:"b"` and any drop on the site went dark. The comment
// beside it claimed two DIFFERENT actors were required; they were not.
//
// A report carries the verified account id when available and always carries
// the salted IP identity. The store deduplicates across both, so one caller
// cannot count once anonymously and again after sign-in. An IP can be changed,
// but it is not a free string the same client picks twice, and no client-supplied
// field reaches the counted axis.

import { callerUserId } from "@/lib/authServer";
import type { PintDropReportIdentity } from "@/lib/pintDrops";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";

/**
 * The identity a report is COUNTED under. Server-derived, always.
 */
export async function pintDropReportIdentity(
  request: Request,
): Promise<PintDropReportIdentity> {
  let userId: string | null = null;
  try {
    userId = await callerUserId(request);
  } catch {
    // An identity lookup we could not run is not a caller we may trust with
    // their own id: fall through to the request's own facts.
    userId = null;
  }
  const ipActorHash = hashActor(`ip:${hashIp(clientIp(request))}`);
  return {
    primaryActorHash: userId ? hashActor(`user:${userId}`) : ipActorHash,
    ipActorHash,
  };
}
