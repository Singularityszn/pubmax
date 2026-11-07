// Launch plan P0 item 7: host-loop analytics.
//
// One place decides when a step counts, so the plan page and the crew page
// cannot drift apart. A step counts only on the server's own first answer to
// the write: a replayed write did nothing new, a cancel is not a request, and
// a decline is not an accept.

import { trackEvent } from "@/lib/analytics";
import { parseCrewArrivedReceipts } from "@/lib/crew";
import type { SocialCrewPublicPreviewDTO, SocialCrewReadDTO } from "@/lib/socialCrew";
import type { CrewMutationOutcome } from "@/lib/socialCrewsUi";

export type HostLoopStep = "open" | "request" | "decide";

/** Send the step's event when the write really did that step. */
export function trackHostLoopStep(
  step: HostLoopStep,
  outcome: CrewMutationOutcome | null,
  crew?: SocialCrewReadDTO | SocialCrewPublicPreviewDTO | null,
): void {
  if (!outcome || outcome.replayed) return;
  if (step === "open" && outcome.code === "created" && outcome.crewId) trackEvent("open_crawl_opened");
  if (
    step === "request" && outcome.code === "requested" &&
    (crew?.kind === "public" || (crew?.kind === "preview" && typeof crew.hostHandle === "string"))
  ) trackEvent("crew_join_requested");
  if (step === "decide" && outcome.code === "accepted") trackEvent("crew_join_accepted");
}

/**
 * Send every arrival receipt a status write answered with. The ingest route
 * counts each band once a night, so a band sent again from a later tap is
 * refused there rather than double counted here.
 */
export function trackCrewArrivedReceipts(crewArrived: unknown): void {
  for (const receipt of parseCrewArrivedReceipts(crewArrived)) {
    trackEvent("crew_arrived", { guestsArrived: receipt.guestsArrived }, { deliveryToken: receipt.deliveryToken });
  }
}
