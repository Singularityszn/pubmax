import { createCrewSeeAgainStore } from "@/lib/crewSeeAgainStore.server";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { isSocialCrewId, socialCrewActor, socialCrewBody, socialCrewExactKeys, socialCrewInvalidResponse,
  socialCrewMutation, socialCrewNotFoundResponse } from "@/lib/socialCrewHttp";

export const runtime = "nodejs";
type Context = { params: Promise<{ crewId: string }> };
const store = createCrewSeeAgainStore();
export async function GET(request: Request, context: Context) {
  const authority = await socialCrewActor(await requireVerifiedSocialActor(request));
  if (!authority.ok) return authority.response;
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  return socialCrewMutation(() => store.read(crewId, authority.actor));
}
export async function POST(request: Request, context: Context) {
  const authority = await socialCrewActor(await requireVerifiedSocialActor(request), true);
  if (!authority.ok) return authority.response;
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  const body = await socialCrewBody(request);
  if (!body.ok) return body.response;
  const { memberId, context: choiceContext, action, consent } = body.body;
  if (!socialCrewExactKeys(body.body, ["memberId", "context", "action", "consent"]) || !isSocialCrewId(memberId)
    || (choiceContext !== "friendship" && choiceContext !== "dating") || (action !== "choose" && action !== "withdraw") || typeof consent !== "boolean"
    || (action === "choose" && !consent)) return socialCrewInvalidResponse();
  if (action === "choose") {
    const frozen = socialFreezeResponse();
    if (frozen) return frozen;
  }
  return socialCrewMutation(() => store.write(crewId, authority.actor, { memberId, context: choiceContext, action, consent }));
}
