import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { socialInteractionStore } from "@/lib/socialInteractionStore";
import {
  isOpenAISocialModerationConfigured,
  OpenAISocialPostModerationAdapter,
} from "@/lib/socialPostModeration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;
  try {
    if (!isOpenAISocialModerationConfigured()) {
      console.warn(
        "[cron:moderate-social-interactions] OPENAI_API_KEY absent: moderation queue skipped.",
      );
      return jsonNoStore({ ok: true, skipped: "openai_not_configured" });
    }
    const result = await socialInteractionStore().processModerationQueue(
      new OpenAISocialPostModerationAdapter(),
      20,
    );
    if (result.processed === 0) {
      return jsonNoStore({ ok: true, skipped: "queue_empty", ...result });
    }
    return jsonNoStore({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron:moderate-social-interactions] queue drain failed:", message);
    return publicApiError("Social interaction moderation is unavailable.", "UNAVAILABLE", 503, {
      retryable: true,
      compatibilityFields: { ok: false },
    });
  }
}
