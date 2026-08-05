import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { socialInteractionStore } from "@/lib/socialInteractionStore";
import { OpenAISocialPostModerationAdapter } from "@/lib/socialPostModeration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;
  try {
    const result = await socialInteractionStore().processModerationQueue(
      new OpenAISocialPostModerationAdapter(),
      20,
    );
    return jsonNoStore({ ok: true, ...result });
  } catch {
    return jsonNoStore(
      { ok: false, error: "Social interaction moderation is unavailable.", retryable: true },
      { status: 503 },
    );
  }
}
