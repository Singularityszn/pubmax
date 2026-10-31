// GET /api/open-crawls
//
// "Crawls you can join this week" on /crawls (launch review 4.5, E1). Open
// crews that carry a plan's capacity, meeting pub and the host's line, with a
// start in the next seven days and at least one place left.
//
// It is the same public lane as the open plans GET /api/out already lists to
// anybody (0110): the host's handle, the night's name, when it starts and where
// to meet, plus the size and the one line. It names no member and carries no
// stop list. Joining still goes through the crew page and its signed-in
// join-request route, and the host still says yes or no.

import { publicApiError } from "@/lib/apiError";
import { makeIpRateLimiter } from "@/lib/ipRateLimit";
import { joinableThisWeek, openCrawlJoinWindow } from "@/lib/openCrawl";
import { isSocialFriendsLaunchEnabled, SOCIAL_FRIENDS_LAUNCH_ENV } from "@/lib/socialLaunch";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const store = createSocialCrewStore();
const isOpenCrawlsLimited = makeIpRateLimiter("open-crawls");

export async function GET(request: Request): Promise<Response> {
  if (await isOpenCrawlsLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const headers = { "cache-control": "no-store" };
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return Response.json({ status: "preview", crawls: [] }, { headers });
  }
  const now = Date.now();
  try {
    const rows = await store.listOpenCrawls(openCrawlJoinWindow(now));
    return Response.json({ status: "ready", crawls: joinableThisWeek(rows, now) }, { headers });
  } catch {
    return Response.json({ status: "degraded", crawls: [] }, { headers });
  }
}
