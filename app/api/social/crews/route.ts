import {
  socialCrewActor,
  socialCrewBody,
  socialCrewExactKeys,
  socialCrewHostCapability,
  socialCrewIdempotencyKey,
  socialCrewInvalidResponse,
  socialCrewMutation,
} from "@/lib/socialCrewHttp";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const store = createSocialCrewStore();

export async function POST(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  const hostCapability = socialCrewHostCapability(request);
  if (!idempotencyKey || !hostCapability) return socialCrewInvalidResponse();
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  if (!socialCrewExactKeys(input.body, ["planId", "visibility"])) {
    return socialCrewInvalidResponse();
  }
  const { planId, visibility } = input.body;
  if (typeof planId !== "string" || (visibility !== "private" && visibility !== "friends")) {
    return socialCrewInvalidResponse();
  }

  return socialCrewMutation(() => store.create(authority.actor, {
    planId,
    hostCapability,
    visibility,
    idempotencyKey,
  }), 201);
}
