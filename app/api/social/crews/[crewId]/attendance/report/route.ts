import { createCrewAttendanceStore } from "@/lib/crewAttendanceStore.server";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import {
  isSocialCrewId, socialCrewActor, socialCrewBody, socialCrewExactKeys, socialCrewInvalidResponse,
  socialCrewMutation, socialCrewNotFoundResponse,
} from "@/lib/socialCrewHttp";

export const runtime = "nodejs";
type Context = { params: Promise<{ crewId: string }> };
const store = createCrewAttendanceStore();

/** A guest reports their own mark by the revision they read. Like every report, a Social freeze does not stop it. */
export async function POST(request: Request, context: Context): Promise<Response> {
  const authority = await socialCrewActor(await requireVerifiedSocialActor(request), true);
  if (!authority.ok) return authority.response;
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  const { revision } = input.body;
  if (!socialCrewExactKeys(input.body, ["revision"]) || !Number.isInteger(revision) || (revision as number) < 1) {
    return socialCrewInvalidResponse();
  }
  return socialCrewMutation(() => store.report(authority.actor, { crewId, revision: revision as number }), 202);
}
