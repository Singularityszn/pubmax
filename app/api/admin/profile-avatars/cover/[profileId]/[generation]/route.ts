// Moderator preview of a reported cover photo.
//   GET /api/admin/profile-avatars/cover/[profileId]/[generation] -> image bytes
//
// The console shows a reported cover as a plain image, so this read carries
// the admin session cookie and no reader bearer. /api/cover refuses a private
// account's cover to everybody but its owner and its mates, so the queue
// previews through here instead: a moderator, and only for a generation that
// waits in the reported-cover queue at the moment of the read. The bytes are
// never cached.

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
  return handleProfileImageServe(
    request,
    "cover",
    await context.params,
    moderatorCoverPreviewRouteDeps(),
  );
}
