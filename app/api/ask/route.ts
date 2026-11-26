import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedJson, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import { runAsk } from "@/lib/ask/runAsk";
import { admitPaidSpend, withPaidSpendRequest } from "@/lib/paidSpendBudget.server";
import { isLimited } from "@/lib/pintDrops";
import { assertProductionSecrets } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";

if (process.env.NODE_ENV === "production") assertProductionSecrets();

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const MAX_QUERY_LENGTH = 500;

/**
 * Night OS Ask (ADR 0014) — unified grounded agent over the tool registry.
 * Keyless deterministic path always works; model tool-calling (Claude when
 * ANTHROPIC_API_KEY is set) is optional and withheld in
 * production without a durable limiter (same fence as concierge).
 */
export function POST(request: Request): Promise<Response> {
  return withPaidSpendRequest(request, () => handlePost(request));
}

async function handlePost(request: Request): Promise<Response> {
  try {
    const limiterKey = `ask:${hashIp(clientIp(request))}`;
    if (await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS, { failClosed: true })) {
      return publicApiError("Too many asks, slow down.", "RATE_LIMITED", 429, { retryable: true });
    }
    let body: unknown;
    try {
      body = await boundedJson(request);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) return publicApiError("Request body is too large.", "PAYLOAD_TOO_LARGE", 413);
      return publicApiError("Malformed JSON.", "MALFORMED_REQUEST", 400);
    }

    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};

    const query =
      typeof record.query === "string"
        ? record.query.trim().slice(0, MAX_QUERY_LENGTH)
        : "";
    if (!query) {
      return publicApiError("Ask a question.", "QUERY_REQUIRED", 400);
    }

    const llmAssistAllowed = isSupabaseConfigured() || process.env.NODE_ENV !== "production";

    const answer = await runAsk({
      query,
      cityId: record.cityId,
      turns: record.turns,
      skipModel: !llmAssistAllowed,
      admitModel: () => admitPaidSpend("ask", request),
      traceRoute: "api/ask",
    });
    return jsonNoStore(answer);
  } catch (error) {
    console.error("ask.unexpected_error", error);
    return publicApiError("Couldn't answer that right now.", "ASK_UNAVAILABLE", 503, { retryable: true });
  }
}
