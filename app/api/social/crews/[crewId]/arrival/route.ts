import {
  isSocialCrewId, socialCrewActor, socialCrewBody, socialCrewExactKeys,
  socialCrewInvalidResponse, socialCrewMutation, socialCrewNotFoundResponse,
} from "@/lib/socialCrewHttp";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

export const runtime = "nodejs";
type Context = { params: Promise<{ crewId: string }> };
const store = createSocialCrewStore();

export async function POST(request: Request, context: Context): Promise<Response> {
  const authority = await socialCrewActor(await requireVerifiedSocialActor(request), true);
  if (!authority.ok) return authority.response;
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  if (!socialCrewExactKeys(input.body, ["here"]) || input.body.here !== true) return socialCrewInvalidResponse();
  return socialCrewMutation(() => store.markArrival(authority.actor, {
    crewId, here: true,
  }));
}
