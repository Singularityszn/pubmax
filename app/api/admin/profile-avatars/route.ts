// Owned-image moderation queue for the admin console (Social Launch WP4).
//   GET  ?status=reported|hidden&slot=avatar|cover -> { avatars: ModeratorProfileImage[] }
//   POST { action, handle, slot?, note? } -> { ok: true }   action ∈ hide | restore
//
// Readers flag via POST /api/profiles/[handle]/{avatar,cover}/report. This route
// is where a human acts. Hide stamps the image hidden (public serve becomes 404,
// so a face falls back to initials and a cover to the brass treatment) and never
// deletes storage or report provenance; restore puts an approved image back.
// Reporter actor hashes never leave the store. `slot` defaults to the face, so a
// console that predates covers keeps working unchanged. A COVER decision crosses
// two stores - see `lib/profileCoverModeration.server.ts` - because the rotation
// holds up to five photographs the console never names.

import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { isProfileImageSlot, type ProfileImageSlot } from "@/lib/profileImageSlots";
import { moderateProfileImageAcrossStores } from "@/lib/profileCoverModeration.server";
import {
  listHiddenProfileImages,
  listReportedProfileImages,
} from "@/lib/profileStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

function requestedSlot(value: unknown): ProfileImageSlot {
  return isProfileImageSlot(value) ? value : "avatar";
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();

  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-avatars:${ipKey}`, `admin-avatars:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const query = new URL(request.url).searchParams;
  const status = query.get("status");
  const slot = requestedSlot(query.get("slot"));
  try {
    const avatars =
      status === "hidden"
        ? await listHiddenProfileImages(slot)
        : await listReportedProfileImages(slot);
    return jsonNoStore({ avatars }, { status: 200 });
  } catch {
    return publicApiError("Image moderation is unavailable right now.", "UNAVAILABLE", 503, {
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
    const slot = requestedSlot(body.slot);
    const ok = await moderateProfileImageAcrossStores(
      handle,
      slot,
      action,
      readString(body.note),
    );
    if (!ok) return publicApiError("Profile image not found.", "NOT_FOUND", 404);
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch {
    return publicApiError("Image moderation is unavailable right now.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
