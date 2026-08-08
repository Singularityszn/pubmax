import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { notifySocialModerationFindings } from "@/lib/socialModerationNotify";
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
    if (action === "inspect-backlog") {
      // Operator read of stranded/growing pending without claiming jobs.
      const backlog = await socialPostStore().inspectModerationBacklog();
      const findings = notifySocialModerationFindings(backlog);
      return jsonNoStore({ ok: true, backlog, ...findings });
    }
    if (action !== null) {
      return publicApiError("Unknown moderation action.", "INVALID_REQUEST", 400, {
        compatibilityFields: { ok: false },
      });
    }
    const store = socialPostStore();
    const result = await store.processModerationQueue(
      new OpenAISocialPostModerationAdapter(),
      20,
    );
    // After every drain: a growing pending backlog or exhausted retries is its
    // own named finding. An outage must never read as "nothing to review".
    const backlog = await store.inspectModerationBacklog();
    const findings = notifySocialModerationFindings(backlog, result);
    return jsonNoStore({ ok: true, ...result, backlog, ...findings });
  } catch {
    return publicApiError("Social post moderation queue is unavailable.", "UNAVAILABLE", 503, {
      retryable: true,
      compatibilityFields: { ok: false },
    });
  }
}
