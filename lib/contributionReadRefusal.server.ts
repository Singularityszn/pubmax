import "server-only";

import { jsonNoStore } from "@/lib/apiResponses";
import { readContributionDoor } from "@/lib/contributionGateStatus";
import type { ContributionIdentityResolution } from "@/lib/contributionIdentity.server";

/**
 * THE ANSWER A READ OF YOUR OWN RECORD GIVES WHEN A GATE STANDS IN FRONT OF IT.
 *
 * A write that the age or handle gate refuses is a 409: the person asked for
 * something and was told no. A READ is different. Opening your own profile asks
 * Wanted, Diary and the nudge settings what they hold on every load, and an
 * account that has not yet tapped "I'm 18 or over" has nothing to hold. Answering
 * those reads 409 made the browser log a console error per read on the first page
 * a new account opens, and made every surface word a gate as "could not load".
 * The gate is data here, not a failure: the same `{ status, error }` body, at 200,
 * so a surface can put its door where the list would be.
 *
 * Only the three gate statuses are softened. A missing sign-in stays a 401, a
 * banned account a 403 and an outage a 503, because each of those is a real
 * refusal of the read.
 */
export function contributionReadRefusalResponse(
  refusal: Extract<ContributionIdentityResolution, { ok: false }>,
): Response {
  return jsonNoStore(refusal.body, {
    status: readContributionDoor(refusal.body) ? 200 : refusal.httpStatus,
  });
}
