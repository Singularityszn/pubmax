import "server-only";

export const PUB_PAL_WEBHOOK_RATE_LIMIT = 6_000;
export const PUB_PAL_WEBHOOK_RATE_WINDOW_MS = 60_000;

export function pubPalWebhookLimiterKey(toolName?: string): string {
  const normalized = toolName?.trim();
  return normalized ? `pub-pal-tool:webhook:${normalized}` : "pub-pal-tool:webhook";
}
