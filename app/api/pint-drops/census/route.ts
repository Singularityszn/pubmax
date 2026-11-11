// GET /api/pint-drops/census: the duty census figure for the composer's
// success state. `count` is null when there is no figure to print
// (lib/dutyCensus.server.ts).

import { publicApiError } from "@/lib/apiError";
import { jsonCached } from "@/lib/apiResponses";
import { loadDutyCensusCount } from "@/lib/dutyCensus.server";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();

const PER_IP_LIMIT = 30;
const GLOBAL_LIMIT = 600;
const WINDOW_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  const ipHash = hashIp(clientIp(request));
  if (
    (await isLimited(`census:${ipHash}`, `census:${ipHash}`, PER_IP_LIMIT, WINDOW_MS)) ||
    (await isLimited("census:global", "census:global", GLOBAL_LIMIT, WINDOW_MS))
  ) {
    return publicApiError("Too many requests, slow down.", "rate_limited", 429, { retryable: true });
  }
  return jsonCached({ count: await loadDutyCensusCount() }, { sMaxAge: 60, staleWhileRevalidate: 300 });
}
