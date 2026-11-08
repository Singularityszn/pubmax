import {
  isSocialCrewId,
  socialCrewActor,
  socialCrewBody,
  socialCrewExactKeys,
  socialCrewIdempotencyKey,
  socialCrewInvalidResponse,
  socialCrewMutation,
  socialCrewNotFoundResponse,
} from "@/lib/socialCrewHttp";
import { crewJoinAcceptedNotice, deferCrewJoinNotice } from "@/lib/crewJoinNotice.server";
import { siteOrigin } from "@/lib/siteUrl";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

type Context = { params: Promise<{ crewId: string; requestId: string }> };

const store = createSocialCrewStore();

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId, requestId } = await context.params;
  if (!isSocialCrewId(crewId) || !isSocialCrewId(requestId)) {
    return socialCrewNotFoundResponse();
  }
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  if (!socialCrewExactKeys(input.body, ["decision"]) ||
    (input.body.decision !== "accept" && input.body.decision !== "decline")) {
    return socialCrewInvalidResponse();
  }

  const actor = authority.actor;
  return socialCrewMutation(async () => {
    const result = await store.decideJoin(actor, {
      crewId,
      requestId,
      decision: input.body.decision as "accept" | "decline",
      idempotencyKey,
    });
    // P0 item 3: a new acceptance tells the guest. A decline or a replay tells nobody.
    const memberId = result.memberId;
    if (result.code === "accepted" && memberId) {
      deferCrewJoinNotice(
        () => crewJoinAcceptedNotice(() => store.read(crewId, actor), actor, crewId, memberId, requestId),
        siteOrigin(request.url) ?? new URL(request.url).origin,
      );
    }
    return result;
  });
}
