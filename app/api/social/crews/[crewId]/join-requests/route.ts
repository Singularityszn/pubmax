import {
  isSocialCrewId,
  socialCrewActor,
  socialCrewBody,
  socialCrewEmptyBody,
  socialCrewIdempotencyKey,
  socialCrewInvalidResponse,
  socialCrewMutation,
  socialCrewNotFoundResponse,
} from "@/lib/socialCrewHttp";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

type Context = { params: Promise<{ crewId: string }> };

const store = createSocialCrewStore();

async function changeJoinRequest(
  request: Request,
  context: Context,
  action: "request" | "cancel",
): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  const input = await socialCrewBody(request, true);
  if (!input.ok) return input.response;
  if (!socialCrewEmptyBody(input.body)) return socialCrewInvalidResponse();

  return socialCrewMutation(() => store.requestJoin(authority.actor, {
    crewId,
    action,
    idempotencyKey,
  }), action === "request" ? 201 : 200);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return changeJoinRequest(request, context, "request");
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  return changeJoinRequest(request, context, "cancel");
}
