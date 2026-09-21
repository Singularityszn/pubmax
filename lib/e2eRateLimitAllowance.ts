// Test-harness only. Production never sets PUBMAX_E2E_RATE_LIMIT_MAX.
// Playwright's webServer.env raises the in-process limiter so two workers
// cannot 429 `/api/citymcp/*` and `/api/plans/generate` into console errors.
// The production numbers (8 / 60s for plan generate, 60 / 60s for CityMCP)
// stay the defaults whenever the env is absent.

export function applyE2ERateLimitAllowance(limit: number): number {
  const raw = process.env.PUBMAX_E2E_RATE_LIMIT_MAX;
  if (!raw) return limit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return limit;
  return Math.max(limit, parsed);
}
