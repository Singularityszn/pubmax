import {
  isSocialCrewId,
  socialCrewPublicJson,
  socialCrewPublicNotFoundResponse,
  socialCrewPublicUnavailableResponse,
} from "@/lib/socialCrewHttp";
import { loadOpenCrawlPublicPreview } from "@/lib/openCrawlShareCard.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ crewId: string }> };

/**
 * Account-free read for a listed Open Crew. The database is the visibility and
 * lifecycle authority; the current venue/POI index is the meeting-point
 * authority. The Social Crews notice at /privacy#crews owns the public
 * disclosure contract. Joining remains on the verified Social route.
 */
export async function GET(_request: Request, context: Context): Promise<Response> {
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewPublicNotFoundResponse();

  const result = await loadOpenCrawlPublicPreview(crewId);
  if (!result.ok) {
    return result.reason === "missing"
      ? socialCrewPublicNotFoundResponse()
      : socialCrewPublicUnavailableResponse();
  }
  const { card, meetingPoint } = result;
  return socialCrewPublicJson({
    kind: "public",
    crewId: card.crewId,
    title: card.title,
    hostHandle: card.hostHandle,
    startsAt: new Date(card.startsAt).toISOString(),
    meetingPoint,
    area: card.area,
    placesLeft: card.placesLeft,
    spendBand: card.spendBand,
    stillTrue: result.stillTrue,
  });
}
