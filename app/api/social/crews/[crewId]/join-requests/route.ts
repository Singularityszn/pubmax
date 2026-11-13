import {
  isSocialCrewId,
  socialCrewActor,
  socialCrewBody,
  socialCrewEmptyBody,
  socialCrewIdempotencyKey,
  socialCrewInvalidResponse,
  socialCrewMutation,
  socialCrewNotFoundResponse,
  socialCrewPrivateJson,
  socialCrewErrorResponse,
} from "@/lib/socialCrewHttp";
import { crewJoinRequestNotice, deferCrewJoinNotice } from "@/lib/crewJoinNotice.server";
import { siteOrigin } from "@/lib/siteUrl";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

type Context = { params: Promise<{ crewId: string }> };
type Access = Awaited<ReturnType<typeof requireVerifiedSocialActor>>;

const store = createSocialCrewStore();

export async function GET(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access);
  if (!authority.ok) return authority.response;

  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  try {
    return socialCrewPrivateJson(
      await store.listJoinRequests(crewId, authority.actor),
    );
  } catch (error) {
    return socialCrewErrorResponse(error);
  }
}

async function changeJoinRequest(
  request: Request,
  context: Context,
  action: "request" | "cancel",
  access: Access,
): Promise<Response> {
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  const input = await socialCrewBody(request, true);
  if (!input.ok) return input.response;
  if (!socialCrewEmptyBody(input.body)) return socialCrewInvalidResponse();

  const actor = authority.actor;
  return socialCrewMutation(async () => {
    const result = await store.requestJoin(actor, { crewId, action, idempotencyKey });
    // P0 item 3: a new request tells the host. A replay or a cancel tells nobody.
    const requestId = result.requestId;
    if (action === "request" && result.code === "requested" && requestId) {
      deferCrewJoinNotice(
        () => crewJoinRequestNotice(() => store.readPublicPreview(crewId), actor, crewId, requestId),
        siteOrigin(request.url) ?? new URL(request.url).origin,
      );
    }
    return result;
  }, action === "request" ? 201 : 200);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  return changeJoinRequest(request, context, "request", access);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  return changeJoinRequest(request, context, "cancel", access);
}
