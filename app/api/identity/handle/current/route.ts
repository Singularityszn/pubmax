import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { identityHandleStore } from "@/lib/identityHandleStore";
import { profileStore } from "@/lib/profileStore";

export async function GET(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) return publicApiError("Sign in to view your PUBMAXX handle.", "UNAUTHENTICATED", 401);
  const profile = await profileStore().getByUserId(ownerId);
  if (!profile) return jsonNoStore({ handle: null });
  const resolution = await identityHandleStore().resolve(profile.handle);
  return jsonNoStore({
    handle:
      resolution?.profileId === profile.id
        ? resolution.currentHandle
        : profile.handle,
    // "Who am I here" answers the founding number too, off the row this route
    // already loaded. One reader (components/founding/useFoundingMembership.ts)
    // asks this question for every surface that shows the mark, so the account
    // hub and the arrival greeting can never disagree about it.
    foundingMemberNumber: profile.foundingMemberNumber ?? null,
  });
}
