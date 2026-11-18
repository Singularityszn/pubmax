import { isCrewAttendanceState } from "@/lib/crewAttendance";
import { createCrewAttendanceStore } from "@/lib/crewAttendanceStore.server";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import {
  isSocialCrewId, socialCrewActor, socialCrewBody, socialCrewExactKeys, socialCrewIdempotencyKey,
  socialCrewInvalidResponse, socialCrewMutation, socialCrewNotFoundResponse,
} from "@/lib/socialCrewHttp";

export const runtime = "nodejs";
type Context = { params: Promise<{ crewId: string }> };
const store = createCrewAttendanceStore();

export async function GET(request: Request, context: Context): Promise<Response> {
  const authority = await socialCrewActor(await requireVerifiedSocialActor(request));
  if (!authority.ok) return authority.response;
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  return socialCrewMutation(() => store.read(crewId, authority.actor));
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const authority = await socialCrewActor(await requireVerifiedSocialActor(request), true);
  if (!authority.ok) return authority.response;
  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  const { memberId, state, expectedRevision } = input.body;
  if (!socialCrewExactKeys(input.body, ["memberId", "state", "expectedRevision"]) || !isSocialCrewId(memberId)
    || !isCrewAttendanceState(state) || !Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) {
    return socialCrewInvalidResponse();
  }
  return socialCrewMutation(() => store.attest(authority.actor, {
    crewId, memberId, state, expectedRevision: expectedRevision as number, idempotencyKey,
  }));
}
