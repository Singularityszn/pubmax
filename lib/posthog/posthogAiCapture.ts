import { currentAnalyticsAttributionProps } from "@/lib/analyticsAttribution.mjs";
import { isPosthogConfigured } from "@/lib/posthogServer";

const POSTHOG_EU_CAPTURE_URL = "https://eu.i.posthog.com/capture/";
const POSTHOG_TIMEOUT_MS = 1_500;
const SERVER_DISTINCT_ID = "pubmaxx-server-llm";

export type PosthogAiGenerationReport = {
  route: string;
  model: string;
  provider?: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  isError?: boolean;
};

function finiteToken(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function finiteCost(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

/**
 * Fire-and-forget `$ai_generation` without prompt or completion payloads.
 */
export function capturePosthogAiGeneration(report: PosthogAiGenerationReport): void {
  const apiKey = process.env.POSTHOG_PROJECT_API_KEY?.trim()
    || process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim()
    || "";
  if (!apiKey || !isPosthogConfigured()) return;

  const inputTokens = finiteToken(report.promptTokens);
  const outputTokens = finiteToken(report.completionTokens);
  const totalTokens = finiteToken(report.totalTokens);
  const totalCostUsd = finiteCost(report.totalCostUsd);
  const latencySeconds = Math.max(0, report.latencyMs) / 1000;

  void fetch(POSTHOG_EU_CAPTURE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      event: "$ai_generation",
      properties: {
        ...currentAnalyticsAttributionProps(),
        distinct_id: SERVER_DISTINCT_ID,
        $process_person_profile: false,
        $ai_model: report.model.slice(0, 120),
        $ai_provider: (report.provider ?? "openrouter").slice(0, 40),
        $ai_latency: latencySeconds,
        ...(inputTokens !== undefined ? { $ai_input_tokens: inputTokens } : {}),
        ...(outputTokens !== undefined ? { $ai_output_tokens: outputTokens } : {}),
        ...(totalTokens !== undefined ? { $ai_total_tokens: totalTokens } : {}),
        ...(totalCostUsd !== undefined ? { $ai_total_cost_usd: totalCostUsd } : {}),
        ...(report.isError ? { $ai_is_error: true } : {}),
        route: report.route.slice(0, 80),
      },
      timestamp: new Date().toISOString(),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(POSTHOG_TIMEOUT_MS),
  }).catch(() => undefined);
}
