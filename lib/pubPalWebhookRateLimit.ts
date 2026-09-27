import "server-only";

export const PUB_PAL_WEBHOOK_RATE_LIMIT = 6_000;
export const PUB_PAL_WEBHOOK_RATE_WINDOW_MS = 60_000;

export function pubPalWebhookLimiterKey(lane: "tool" | "llm", toolName?: string): string {
  if (lane === "llm") return "pub-pal-llm:webhook";
  const normalized = toolName?.trim();
  return normalized ? `pub-pal-tool:webhook:${normalized}` : "pub-pal-tool:webhook";
}
