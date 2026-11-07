import {
  isSocialCrewId,
  socialCrewPublicJson,
  socialCrewPublicNotFoundResponse,
  socialCrewPublicUnavailableResponse,
} from "@/lib/socialCrewHttp";
import { loadOpenCrawlShareCard } from "@/lib/openCrawlShareCard.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ crewId: string }> };

/**
 * Account-free read for a listed Open Crew. The database is the visibility and
 * lifecycle authority; the current venue/POI index is the meeting-point
 * authority. It answers what the link preview prints (launch plan P0 item 4):
 * the host's handle, the time, the meeting pub, the area, the places left and
 * the pint price band. It never names a member or a stop. Joining remains on
 * the verified Social route.
 */
export async function GET(_request: Request, context: Context): Promise<Response> {
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewPublicNotFoundResponse();

  const result = await loadOpenCrawlShareCard(crewId);
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
  });
}
