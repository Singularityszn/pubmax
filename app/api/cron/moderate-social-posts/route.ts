import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { OpenAISocialPostModerationAdapter } from "@/lib/socialPostModeration";
import { socialPostStore } from "@/lib/socialPostStore";
import { purgeDetachedSocialPhotos } from "@/lib/socialPostMedia.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;
  try {
    const action = new URL(request.url).searchParams.get("action");
    if (action === "requeue-terminal") {
      const requeued = await socialPostStore().requeueTerminalModeration(20);
      return jsonNoStore({ ok: true, requeued });
    }
    if (action === "purge-detached-media") {
      const purged = await purgeDetachedSocialPhotos(50);
      return jsonNoStore({ ok: true, purged });
    }
    if (action !== null) {
      return publicApiError("Unknown moderation action.", "INVALID_REQUEST", 400, {
        compatibilityFields: { ok: false },
      });
    }
    const result = await socialPostStore().processModerationQueue(
      new OpenAISocialPostModerationAdapter(),
      20,
    );
    return jsonNoStore({ ok: true, ...result });
  } catch {
    return publicApiError("Social post moderation queue is unavailable.", "UNAVAILABLE", 503, {
      retryable: true,
      compatibilityFields: { ok: false },
    });
  }
}
