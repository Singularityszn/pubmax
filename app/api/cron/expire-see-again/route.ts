import { publicApiError } from "@/lib/apiError";
import { assertCronRequest } from "@/lib/cronAuth";
import { createCrewSeeAgainStore } from "@/lib/crewSeeAgainStore.server";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const denied = assertCronRequest(request);
  if (denied) return denied;
  try {
    return Response.json(await createCrewSeeAgainStore().expire(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[expire-see-again] Private record expiry failed. Operator action is required.");
    return publicApiError("Private record expiry failed.", "SEE_AGAIN_EXPIRY_FAILED", 503, { retryable: true });
  }
}
