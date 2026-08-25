import { handleCreatorListDiscoveryRequest } from "@/lib/creatorListDiscoveryRoute.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  return handleCreatorListDiscoveryRequest(request);
}
