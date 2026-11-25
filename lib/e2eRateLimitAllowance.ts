// Concurrent test workers share a loopback address. The harness allowance must
// never widen a production limiter, including during production-build tests.

export function applyE2ERateLimitAllowance(limit: number): number {
  if (process.env.NODE_ENV === "production") return limit;
  const raw = process.env.PUBMAX_E2E_RATE_LIMIT_MAX;
  if (!raw) return limit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return limit;
  return Math.max(limit, parsed);
}
