// E1 "Open it up" (launch review 4.5): a host turns their locked plan into an
// Open Crew that carries it, with a capacity, a meeting pub and one line.
//
// It lives under /api/plans/[id]/… on purpose: the host's seat capability is
// usually the path-scoped HttpOnly member cookie (Path=/api/plans/${planId}),
// which a request to /api/social/crews never carries. The Authorization header
// belongs to the signed-in account (the verified Social actor), so the seat
// capability is read from the body or the cookie and never from that header.
//
// Two authorities, both required: the verified Social actor (who will own the
// crew) and the plan's host seat. The database checks the seat again inside
// open_social_crew_with_plan_atomic (0208), which is the one write.

import { publicApiError } from "@/lib/apiError";
import { OPEN_PLAN_PLACE_REFUSED_LINE } from "@/lib/openSocialCrew";
import { resolveOpenMeetingPoint } from "@/lib/openSocialCrew.server";
import { validateOpenCrawlInput } from "@/lib/openCrawl";
import { isPlanId } from "@/lib/plan";
import { planMemberCookieCapability } from "@/lib/planMemberCapability";
import { PLAN_HTTP_ONLY_SESSION } from "@/lib/planSessionCapability";
import { planMemberIdentityResult, planStateResult } from "@/lib/planStore";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import {
  socialCrewActor,
  socialCrewBody,
  socialCrewHouseError,
  socialCrewIdempotencyKey,
  socialCrewInvalidResponse,
  socialCrewMutation,
  socialCrewNotFoundResponse,
  socialCrewUnavailableResponse,
} from "@/lib/socialCrewHttp";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const store = createSocialCrewStore();

const BODY_KEYS = new Set(["memberToken", "capacity", "meetingVenueId", "description"]);

/** The seat capability from the body, else the path-scoped cookie. Never the bearer. */
function hostSeatCapability(request: Request, planId: string, memberToken: unknown): string | null {
  if (typeof memberToken === "string") {
    const token = memberToken.trim();
    if (token && token !== PLAN_HTTP_ONLY_SESSION && token.length <= 512 && !/\s/.test(token)) return token;
  }
  return planMemberCookieCapability(request, planId) ?? null;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { id: planId } = await context.params;
  if (!isPlanId(planId)) return socialCrewNotFoundResponse();

  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  if (Object.keys(input.body).some((key) => !BODY_KEYS.has(key))) return socialCrewInvalidResponse();

  const memberToken = hostSeatCapability(request, planId, input.body.memberToken);
  if (!memberToken) return socialCrewNotFoundResponse();

  const state = await planStateResult(planId);
  if (!state.ok) return socialCrewUnavailableResponse();
  // A plan that is gone, or already a crew, answers exactly as one that is not
  // the caller's: a refusal here is never an existence oracle.
  if (!state.plan) return socialCrewNotFoundResponse();

  const identity = await planMemberIdentityResult(planId, memberToken);
  if (!identity.ok) return socialCrewUnavailableResponse();
  if (identity.identity?.role !== "host") return socialCrewNotFoundResponse();

  const checked = validateOpenCrawlInput(input.body, state.plan.stops);
  if (!checked.ok) {
    return publicApiError(checked.line, "OPEN_CRAWL_INVALID", 422, {
      headers: { "Cache-Control": "private, no-store" },
      details: { field: checked.field },
    });
  }

  const meeting = await resolveOpenMeetingPoint(checked.value.meetingVenueId);
  if (meeting.ok === false && meeting.reason === "unavailable") return socialCrewUnavailableResponse();
  if (!meeting.ok) {
    return socialCrewHouseError(OPEN_PLAN_PLACE_REFUSED_LINE, "OPEN_PLAN_PLACE_REFUSED", 422);
  }

  return socialCrewMutation(() => store.openWithPlan(authority.actor, {
    planId,
    hostCapability: memberToken,
    capacity: checked.value.capacity,
    meetingVenueId: checked.value.meetingVenueId,
    description: checked.value.description,
    idempotencyKey,
  }), 201);
}
