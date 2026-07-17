import { callerUserId } from "@/lib/authServer";
import { jsonNoStore } from "@/lib/apiResponses";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const usage = new Map<string, { count: number; month: string }>();
const MONTHLY_TRIAL_SESSIONS = 10;

export async function POST(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) return jsonNoStore({ error: "Sign in to talk with your Pub Pal." }, { status: 401 });
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim();
  if (!apiKey || !agentId) return jsonNoStore({ error: "Voice is not configured yet.", fallback: "text" }, { status: 503 });
  const month = new Date().toISOString().slice(0, 7);
  const current = usage.get(userId);
  const meter = current?.month === month ? current : { count: 0, month };
  if (!isSupabaseConfigured() && meter.count >= MONTHLY_TRIAL_SESSIONS) return jsonNoStore({ error: "Your trial voice allowance is used for this month.", fallback: "text", remaining: 0 }, { status: 429 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
    url.searchParams.set("agent_id", agentId);
    url.searchParams.set("include_conversation_id", "true");
    const response = await fetch(url, { headers: { "xi-api-key": apiKey }, signal: controller.signal, cache: "no-store" });
    if (!response.ok) return jsonNoStore({ error: "Voice service is temporarily unavailable.", fallback: "text" }, { status: 502 });
    const body = await response.json() as { signed_url?: string };
    if (!body.signed_url) return jsonNoStore({ error: "Voice service returned no session.", fallback: "text" }, { status: 502 });
    if (isSupabaseConfigured()) {
      const { data, error } = await requireSupabaseAdmin().rpc("consume_pub_pal_voice_trial", { p_owner_id: userId, p_month: `${month}-01`, p_limit: MONTHLY_TRIAL_SESSIONS });
      if (error) return jsonNoStore({ error: "Voice allowance could not be verified.", fallback: "text" }, { status: 503 });
      if (data === false) return jsonNoStore({ error: "Your trial voice allowance is used for this month.", fallback: "text", remaining: 0 }, { status: 429 });
    } else { meter.count += 1; usage.set(userId, meter); }
    return jsonNoStore({ signedUrl: body.signed_url, connectionType: "websocket", remaining: isSupabaseConfigured() ? null : MONTHLY_TRIAL_SESSIONS - meter.count, retention: "zero", mutationPolicy: "propose_then_confirm" });
  } catch {
    return jsonNoStore({ error: "Voice service did not respond in time.", fallback: "text" }, { status: 504 });
  } finally { clearTimeout(timeout); }
}
