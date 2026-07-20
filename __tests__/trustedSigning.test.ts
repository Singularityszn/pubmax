import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import playwrightConfig from "../playwright.config";

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
  it("injects a fresh strong signing secret into each production-style Playwright server", async () => {
    const webServer = playwrightConfig.webServer as { command?: string } | undefined;
    const command = webServer?.command ?? "";
    const encodedSecret = /PLAN_IDEMPOTENCY_SECRET=([A-Za-z0-9_-]+)/.exec(command)?.[1];

    expect(encodedSecret).toBeTruthy();
    expect(Buffer.from(encodedSecret!, "base64url")).toHaveLength(32);
    expect(command).toContain("PUBMAX_E2E_KEYLESS=1");

    vi.resetModules();
    const nextConfig = (await import("../playwright.config")).default;
    const nextWebServer = nextConfig.webServer as { command?: string } | undefined;
    const nextSecret = /PLAN_IDEMPOTENCY_SECRET=([A-Za-z0-9_-]+)/.exec(nextWebServer?.command ?? "")?.[1];
    expect(nextSecret).toBeTruthy();
    expect(nextSecret).not.toBe(encodedSecret);
  });

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

  it("fails closed in every production runtime even when the storage E2E escape is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    clearSigningEnv();
    process.env.PUBMAX_E2E_KEYLESS = "1";
    const production = await import("@/lib/verifiedAnalytics.server");

    expect(() => production.mintVerifiedAnalyticsToken(analyticsEvent, "plan:production", occurredAt))
      .toThrow(/signing secret/i);

    process.env.PLAN_IDEMPOTENCY_SECRET = "production-e2e-signing-key-0123456789abcdef";
    const token = production.mintVerifiedAnalyticsToken(analyticsEvent, "plan:production", occurredAt);
    expect(production.verifyAnalyticsDeliveryToken(token, analyticsEvent, issuedAt + 1_000)).not.toBeNull();
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
