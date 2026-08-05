import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { OpenAISocialPostModerationAdapter } from "@/lib/socialPostModeration";
import { socialPostStore } from "@/lib/socialPostStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;
  try {
    const result = await socialPostStore().processModerationQueue(
      new OpenAISocialPostModerationAdapter(),
      20,
    );
    return jsonNoStore({ ok: true, ...result });
  } catch {
    return jsonNoStore(
      { ok: false, error: "Social post moderation queue is unavailable.", retryable: true },
      { status: 503 },
    );
  }
}
