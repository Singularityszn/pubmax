import { cleanEndingSelection, type CrawlEnding, type PlanState } from "@/lib/plan";
import { canonicalEndingSelection } from "@/lib/planEndingSelection.server";
import { completeSocialCrewPlan } from "@/lib/socialCrewCompletionStore";
import {
  isSocialCrewId,
  socialCrewActor,
  socialCrewBody,
  socialCrewErrorResponse,
  socialCrewInvalidResponse,
  socialCrewNotFoundResponse,
  socialCrewPrivateJson,
} from "@/lib/socialCrewHttp";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";
import { cleanText } from "@/lib/textClean";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ crewId: string }> };
const store = createSocialCrewStore();
const ENDINGS: CrawlEnding[] = ["food", "get_home", "keep_going"];

export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  const parsed = await socialCrewBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (Object.keys(body).some((key) => ![
    "expectedRouteRevision", "arrivedStopPosition", "ending", "terminalVenueId", "endingSelection",
  ].includes(key))) return socialCrewInvalidResponse();
  const ending = typeof body.ending === "string" && ENDINGS.includes(body.ending as CrawlEnding)
    ? body.ending as CrawlEnding : null;
  const selection = ending ? cleanEndingSelection(body.endingSelection, ending) : null;
  const terminalVenueId = cleanText(body.terminalVenueId, 80);
  if (!ending || !selection ||
    !Number.isInteger(body.expectedRouteRevision) || Number(body.expectedRouteRevision) < 1 ||
    !Number.isInteger(body.arrivedStopPosition) || Number(body.arrivedStopPosition) < 0 ||
    (ending === "food" && !terminalVenueId)) return socialCrewInvalidResponse();

  try {
    const crew = await store.read(crewId, authority.actor);
    if (crew.kind !== "member" || crew.viewer.role !== "owner") return socialCrewNotFoundResponse();
    if (!crew.plan.stops.some((stop) => stop.position === body.arrivedStopPosition)) {
      return socialCrewInvalidResponse();
    }
    const plan: PlanState = { ...crew.plan, crew: [] };
    const canonicalSelection = await canonicalEndingSelection(plan, selection, terminalVenueId);
    if (!canonicalSelection) return socialCrewInvalidResponse();
    const result = await completeSocialCrewPlan({
      actorAccountId: authority.actor.accountId,
      crewId,
      planId: crew.plan.plan.id,
      expectedRouteRevision: Number(body.expectedRouteRevision),
      arrivedStopPosition: Number(body.arrivedStopPosition),
      ending,
      terminalVenueId,
      endingSelection: canonicalSelection,
    });
    const updated = await store.read(crewId, authority.actor);
    if (updated.kind !== "member") return socialCrewNotFoundResponse();
    return socialCrewPrivateJson({ crew: updated, completion: result.completion, created: result.created },
      { status: result.created ? 201 : 200 });
  } catch (error) {
    return socialCrewErrorResponse(error);
  }
}
