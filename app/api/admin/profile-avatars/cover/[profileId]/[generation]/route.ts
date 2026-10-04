// Moderator preview of a reported cover photo.
//   GET /api/admin/profile-avatars/cover/[profileId]/[generation] -> image bytes
//
// The console renders a reported cover as a plain image, so this read carries
// the admin session cookie and no reader bearer. A private profile's cover is
// refused on /api/cover to everyone but the owner and mutual mates, so the
// queue previews through here instead: a moderator, and only for a generation
// that waits in the reported-cover queue at the moment of the read. Bytes are
// private and never cached.

import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { handleProfileImageServe } from "@/lib/profileImageServe.server";
import { moderatorCoverPreviewRouteDeps } from "@/lib/profileImageServeRouteDeps.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

type RouteContext = { params: Promise<{ profileId: string; generation: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  if (!isModerator(request)) {
    return publicApiError("Moderator access required.", "FORBIDDEN", 403, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return handleProfileImageServe(request, "cover", await context.params, moderatorCoverPreviewRouteDeps());
}
