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
  });
}
