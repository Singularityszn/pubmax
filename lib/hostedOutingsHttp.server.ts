import "server-only";

import { publicApiError } from "@/lib/apiError";
import { withAuthResumeCookie } from "@/lib/authSessionResume";
import { boundedJson } from "@/lib/boundedRequest.server";
import { HostedOutingError } from "@/lib/hostedOutingStore.server";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { hashActor } from "@/lib/supabase";

export async function hostedOutingRoute(request: Request, write: boolean, operation: (actor: SocialPostActor, input: Record<string, unknown>) => Promise<unknown>): Promise<Response> {
  const access = await requireVerifiedSocialActor(request).catch(() => null);
  if (!access) return publicApiError("We could not check your sign-in. Try again.", "AUTH_UNAVAILABLE", 503, { retryable: true });
  const finish = (response: Response) => withAuthResumeCookie(response, access.resumeCookie);
  if (!access.ok) return finish(publicApiError(access.error, access.code, access.status, { retryable: access.retryable === true }));
  try {
    const key = `hosted-outing:${hashActor(access.actor.profileId)}`;
    if (await isLimited(key, key, write ? 30 : 90, 60_000)) {
      return finish(publicApiError("Too many outing requests. Slow down.", "HOSTED_RATE_LIMITED", 429, { retryable: true }));
    }
    let input: Record<string, unknown> = {};
    if (write) {
      let value: unknown;
      try { value = await boundedJson(request, 8192); } catch {
        throw new HostedOutingError("HOSTED_INVALID", 422, "Check the outing request.");
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new HostedOutingError("HOSTED_INVALID", 422, "Check the outing request.");
      input = value as Record<string, unknown>;
    }
    return finish(Response.json(await operation(access.actor, input), { headers: { "Cache-Control": "private, no-store" } }));
  } catch (error) {
    if (error instanceof HostedOutingError) return finish(publicApiError(error.message, error.code, error.status, { retryable: error.status === 503 }));
    return finish(publicApiError("Hosted outings are unavailable. Try again.", "HOSTED_UNAVAILABLE", 503, { retryable: true }));
  }
}
