import {
  isSocialCrewId,
  socialCrewActor,
  socialCrewBody,
  socialCrewErrorResponse,
  socialCrewExactKeys,
  socialCrewIdempotencyKey,
  socialCrewInvalidResponse,
  socialCrewMutation,
  socialCrewNotFoundResponse,
  socialCrewPrivateJson,
} from "@/lib/socialCrewHttp";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ crewId: string }> };

const store = createSocialCrewStore();

export async function GET(_request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  const authority = await socialCrewActor(access);
  if (!authority.ok) return authority.response;
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  try {
    return socialCrewPrivateJson(await store.read(crewId, authority.actor));
  } catch (error) {
    return socialCrewErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  if (!socialCrewExactKeys(input.body, ["visibility", "expectedAuthorityRevision"])) {
    return socialCrewInvalidResponse();
  }
  const { visibility, expectedAuthorityRevision } = input.body;
  if (
    (visibility !== "private" && visibility !== "friends") ||
    !Number.isInteger(expectedAuthorityRevision) ||
    Number(expectedAuthorityRevision) < 0
  ) {
    return socialCrewInvalidResponse();
  }

  return socialCrewMutation(() => store.updateVisibility(authority.actor, {
    crewId,
    visibility,
    expectedAuthorityRevision: Number(expectedAuthorityRevision),
    idempotencyKey,
  }));
}
