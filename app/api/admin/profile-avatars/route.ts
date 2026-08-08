// Owned-avatar moderation queue for the admin console (Social Launch WP4).
//   GET  ?status=reported|hidden -> { avatars: ModeratorProfileAvatar[] }
//   POST { action, handle, note? } -> { ok: true }   action ∈ hide | restore
//
// Readers flag via POST /api/profiles/[handle]/avatar/report. This route is
// where a human acts. Hide stamps the face hidden (public serve becomes 404 /
// initials) and never deletes storage or report provenance; restore puts an
// approved face back. Reporter actor hashes never leave the store.

import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import {
  listHiddenProfileAvatars,
  listReportedProfileAvatars,
  moderateProfileAvatar,
} from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-avatars:${ipKey}`, `admin-avatars:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const status = new URL(request.url).searchParams.get("status");
  try {
    const avatars =
      status === "hidden"
        ? await listHiddenProfileAvatars()
        : await listReportedProfileAvatars();
    return jsonNoStore({ avatars }, { status: 200 });
  } catch {
    return publicApiError("Avatar moderation is unavailable right now.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const handle = normalizeHandle(readString(body.handle) ?? "");
  if (!handle) return publicApiError("Missing handle.", "INVALID_REQUEST", 400);

  const action = readString(body.action);
  if (action !== "hide" && action !== "restore") {
    return publicApiError("Unknown action.", "INVALID_REQUEST", 400);
  }

  try {
    const ok = await moderateProfileAvatar(handle, action, readString(body.note));
    if (!ok) return publicApiError("Profile avatar not found.", "NOT_FOUND", 404);
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch {
    return publicApiError("Avatar moderation is unavailable right now.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
