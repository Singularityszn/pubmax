import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const analyticsEvent = { name: "plan_accepted" as const, props: { stops: 3, grounded: true } };
const candidates = ["venue-a", "venue-b", "venue-c", "venue-d"];
const accepted = candidates.slice(0, 3);
const occurredAt = "2026-07-20T12:00:00.000Z";
const issuedAt = Date.parse(occurredAt);

function clearSigningEnv(): void {
  delete process.env.PLAN_IDEMPOTENCY_SECRET;
  delete process.env.RATE_LIMIT_SALT;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.PUBMAX_E2E_KEYLESS;
  delete process.env.VERCEL_ENV;
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearSigningEnv();
  vi.resetModules();
});

describe("externally trusted signing keys", () => {
  it("fails closed when a Supabase-backed process has no signing secret", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const analytics = await import("@/lib/verifiedAnalytics.server");
    const grounding = await import("@/lib/planGrounding.server");

    expect(() => analytics.mintVerifiedAnalyticsToken(analyticsEvent, "plan:one", occurredAt))
      .toThrow(/signing secret/i);
    expect(() => grounding.mintPlanGroundingProof(candidates, "operation-one", issuedAt))
      .toThrow(/signing secret/i);
  });

  it("fails closed in deployed production but preserves explicit local keyless E2E mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    clearSigningEnv();
    process.env.VERCEL_ENV = "production";
    const deployed = await import("@/lib/verifiedAnalytics.server");
    expect(() => deployed.mintVerifiedAnalyticsToken(analyticsEvent, "plan:production", occurredAt))
      .toThrow(/signing secret/i);

    vi.resetModules();
    delete process.env.VERCEL_ENV;
    process.env.PUBMAX_E2E_KEYLESS = "1";
    const keylessE2e = await import("@/lib/verifiedAnalytics.server");
    const token = keylessE2e.mintVerifiedAnalyticsToken(analyticsEvent, "plan:e2e", occurredAt);
    expect(keylessE2e.verifyAnalyticsDeliveryToken(token, analyticsEvent, issuedAt + 1_000)).not.toBeNull();
  });

  it("uses RATE_LIMIT_SALT as the configured trusted fallback", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.RATE_LIMIT_SALT = "configured-random-rate-salt-0123456789abcdef";
    const analytics = await import("@/lib/verifiedAnalytics.server");

    const token = analytics.mintVerifiedAnalyticsToken(analyticsEvent, "plan:rate-salt", occurredAt);
    expect(analytics.verifyAnalyticsDeliveryToken(token, analyticsEvent, issuedAt + 1_000)).not.toBeNull();
  });

  it("uses one process-local key for keyless mode and rotates it on a new process", async () => {
    vi.stubEnv("NODE_ENV", "development");
    clearSigningEnv();
    const firstProcess = await import("@/lib/verifiedAnalytics.server");
    const token = firstProcess.mintVerifiedAnalyticsToken(analyticsEvent, "plan:one", occurredAt);

    expect(firstProcess.verifyAnalyticsDeliveryToken(token, analyticsEvent, issuedAt + 1_000)).not.toBeNull();
    vi.resetModules();
    const secondProcess = await import("@/lib/verifiedAnalytics.server");
    expect(secondProcess.verifyAnalyticsDeliveryToken(token, analyticsEvent, issuedAt + 1_000)).toBeNull();
  });

  it("rejects tokens forged with the former public development constants", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.PLAN_IDEMPOTENCY_SECRET = "configured-random-signing-key-0123456789abcdef";
    const analytics = await import("@/lib/verifiedAnalytics.server");
    const grounding = await import("@/lib/planGrounding.server");

    const validToken = analytics.mintVerifiedAnalyticsToken(analyticsEvent, "plan:one", occurredAt);
    expect(analytics.verifyAnalyticsDeliveryToken(validToken, analyticsEvent, issuedAt + 1_000)).not.toBeNull();

    const analyticsPayload = validToken.split(".")[0]!;
    const forgedAnalyticsSignature = createHmac("sha256", "pubmax-verified-analytics-development-only")
      .update(`verified-analytics:v1:${analyticsPayload}`)
      .digest("base64url");
    expect(analytics.verifyAnalyticsDeliveryToken(
      `${analyticsPayload}.${forgedAnalyticsSignature}`,
      analyticsEvent,
      issuedAt + 1_000,
    )).toBeNull();

    const validProof = grounding.mintPlanGroundingProof(candidates, "operation-one", issuedAt);
    expect(grounding.verifyPlanGroundingProof(validProof, accepted, "operation-one", issuedAt + 1_000)).toBe(true);
    const groundingPayload = validProof.split(".")[0]!;
    const forgedGroundingSignature = createHmac("sha256", "pubmax-plan-grounding-development-only")
      .update(`plan-grounding:v1:${groundingPayload}`)
      .digest("base64url");
    expect(grounding.verifyPlanGroundingProof(
      `${groundingPayload}.${forgedGroundingSignature}`,
      accepted,
      "operation-one",
      issuedAt + 1_000,
    )).toBe(false);
  });

  it("rejects a short configured secret instead of treating it as trusted", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.PLAN_IDEMPOTENCY_SECRET = "too-short";
    const analytics = await import("@/lib/verifiedAnalytics.server");

    expect(() => analytics.mintVerifiedAnalyticsToken(analyticsEvent, "plan:one", occurredAt))
      .toThrow(/at least 32/i);
  });
});
