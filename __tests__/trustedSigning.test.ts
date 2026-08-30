import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const analyticsEvent = {
  name: "plan_accepted" as const,
  props: { stops: 3, grounded: true, anchored: true, routeReady: true, source: "near" },
};
const candidates = ["venue-a", "venue-b", "venue-c", "venue-d"];
const accepted = candidates.slice(0, 3);
const occurredAt = "2026-07-20T12:00:00.000Z";
const issuedAt = Date.parse(occurredAt);
const crewEvent = {
  name: "crew_committed" as const,
  props: { source: "shared-plan" as const, participants: 2 as const },
};
const crewEventId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function clearSigningEnv(): void {
  delete process.env.PLAN_IDEMPOTENCY_SECRET;
  delete process.env.RATE_LIMIT_SALT;
  delete process.env.CREW_DELIVERY_SIGNING_SECRET;
  delete process.env.CREW_DELIVERY_PREVIOUS_SIGNING_SECRET;
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
  it("injects one fresh strong signing key through Vitest config, never its command", async () => {
    vi.resetModules();
    const firstConfig = (await import("../vitest.config")).default as {
      test?: { env?: Record<string, string> };
    };
    const firstSecret = firstConfig.test?.env?.PLAN_IDEMPOTENCY_SECRET;
    expect(firstSecret).toBeTruthy();
    expect(Buffer.from(firstSecret!, "base64url")).toHaveLength(32);

    vi.resetModules();
    const secondConfig = (await import("../vitest.config")).default as {
      test?: { env?: Record<string, string> };
    };
    expect(secondConfig.test?.env?.PLAN_IDEMPOTENCY_SECRET).not.toBe(firstSecret);

    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.test).not.toContain("PLAN_IDEMPOTENCY_SECRET");
    expect(packageJson.scripts.test).not.toContain(firstSecret!);
  });

  it("injects a fresh strong signing secret into each production-style Playwright server", async () => {
    vi.stubEnv("PW_SCREENSHOTS", "");
    vi.stubEnv("PW_SKIP_WEBSERVER", "");
    vi.stubEnv("PW_PORT", "3100");
    vi.stubEnv("PW_KEYLESS_PORT", "3101");
    vi.resetModules();
    const playwrightConfig = (await import("../playwright.config")).default;
    const configuredWebServers = playwrightConfig.webServer as {
      command?: string;
      env?: Record<string, string>;
      url?: string;
    }[] | undefined;
    const webServers = configuredWebServers ?? [];

    expect(webServers).toHaveLength(2);
    for (const webServer of webServers) {
      const command = webServer.command ?? "";
      const encodedSecret = webServer.env?.PLAN_IDEMPOTENCY_SECRET;
      const crewDeliverySecret = webServer.env?.CREW_DELIVERY_SIGNING_SECRET;
      expect(encodedSecret).toBeTruthy();
      expect(Buffer.from(encodedSecret!, "base64url")).toHaveLength(32);
      expect(crewDeliverySecret).toBeTruthy();
      expect(Buffer.byteLength(crewDeliverySecret!, "utf8")).toBeGreaterThanOrEqual(32);
      expect(crewDeliverySecret).not.toBe(encodedSecret);
      expect(webServer.env?.PUBMAX_E2E_KEYLESS).toBe("1");
      expect(command).not.toContain("PLAN_IDEMPOTENCY_SECRET");
      expect(command).not.toContain("PUBMAX_E2E_KEYLESS");
      expect(command).not.toContain(encodedSecret!);
      expect(command).toContain("npm run build &&");
      expect(command).toContain("npm run start");
    }
    const keylessServer = webServers.find(
      (webServer) => webServer.url === "http://localhost:3101",
    );
    expect(keylessServer?.env?.NEXT_PUBLIC_SUPABASE_URL).toBe("");
    expect(
      keylessServer?.env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ).toBe("");

    vi.resetModules();
    const nextConfig = (await import("../playwright.config")).default;
    const nextWebServers = nextConfig.webServer as {
      env?: Record<string, string>;
    }[] | undefined;
    const nextSecret = nextWebServers?.[0]?.env?.PLAN_IDEMPOTENCY_SECRET;
    expect(nextSecret).toBeTruthy();
    expect(nextSecret).not.toBe(
      webServers[0]?.env?.PLAN_IDEMPOTENCY_SECRET,
    );
  });

  it("can omit the unused keyless server from a targeted browser gate", async () => {
    vi.stubEnv("PW_SCREENSHOTS", "");
    vi.stubEnv("PW_SKIP_WEBSERVER", "");
    vi.stubEnv("PW_SKIP_KEYLESS_WEBSERVER", "1");
    vi.resetModules();

    const config = (await import("../playwright.config")).default;
    const webServers = config.webServer as { url?: string }[] | undefined;

    expect(webServers).toHaveLength(1);
    expect(webServers?.[0]?.url).toBe("http://localhost:3100");
  });

  it("assigns contribution E2E to matching auth projects", async () => {
    vi.stubEnv("PW_SCREENSHOTS", "");
    vi.stubEnv("PW_SKIP_WEBSERVER", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.resetModules();
    const keylessConfig = (await import("../playwright.config")).default;
    const keylessProjects = keylessConfig.projects ?? [];

    expect(keylessProjects.map((project) => project.name)).toContain(
      "chromium-keyless",
    );
    expect(keylessProjects.map((project) => project.name)).not.toContain(
      "chromium-real-auth",
    );
    expect(
      keylessProjects.find((project) => project.name === "chromium-keyless")
        ?.testMatch,
    ).toEqual([
      "**/price-contribution-entry.spec.ts",
      "**/spill-composer-keyless.spec.ts",
      "**/ui-ux-battle-test-keyless.spec.ts",
    ]);

    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://real-auth.example.supabase.co",
    );
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "real-publishable-key",
    );
    vi.resetModules();
    const realAuthConfig = (await import("../playwright.config")).default;
    const realAuthProject = realAuthConfig.projects?.find(
      (project) => project.name === "chromium-real-auth",
    );

    expect(realAuthProject?.testMatch).toBe(
      "**/price-contribution-auth.spec.ts",
    );
  });

  it("fails closed when a Supabase-backed process has no signing secret", async () => {
    vi.stubEnv("NODE_ENV", "development");
    clearSigningEnv();
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
    clearSigningEnv();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.RATE_LIMIT_SALT = "configured-random-rate-salt-0123456789abcdef";
    const analytics = await import("@/lib/verifiedAnalytics.server");

    const token = analytics.mintVerifiedAnalyticsToken(analyticsEvent, "plan:rate-salt", occurredAt);
    expect(analytics.verifyAnalyticsDeliveryToken(token, analyticsEvent, issuedAt + 1_000)).not.toBeNull();
  });

  it("keeps V2 crew delivery stable when only Plan mutation identity changes", async () => {
    vi.stubEnv("NODE_ENV", "development");
    clearSigningEnv();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.CREW_DELIVERY_SIGNING_SECRET = "crew-delivery-secret-0123456789abcdef";
    process.env.PLAN_IDEMPOTENCY_SECRET = "plan-identity-secret-one-0123456789abcdef";
    const analytics = await import("@/lib/verifiedAnalytics.server");
    const first = analytics.crewCommittedEventToken({
      crewCommittedEventId: crewEventId,
      crewCommittedAt: occurredAt,
      issuedAt,
    });

    process.env.PLAN_IDEMPOTENCY_SECRET = "plan-identity-secret-two-0123456789abcdef";
    const second = analytics.crewCommittedEventToken({
      crewCommittedEventId: crewEventId,
      crewCommittedAt: occurredAt,
      issuedAt,
    });

    expect(second).toBe(first);
    expect(analytics.verifyAnalyticsDeliveryToken(second, crewEvent, issuedAt + 1_000)).not.toBeNull();
  });

  it("requires CREW_DELIVERY_SIGNING_SECRET for durable V2 crew delivery", async () => {
    vi.stubEnv("NODE_ENV", "development");
    clearSigningEnv();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.PLAN_IDEMPOTENCY_SECRET = "stable-plan-identity-secret-0123456789abcdef";
    const analytics = await import("@/lib/verifiedAnalytics.server");

    expect(() => analytics.crewCommittedEventToken({
      crewCommittedEventId: crewEventId,
      crewCommittedAt: occurredAt,
      issuedAt,
    })).toThrow(/CREW_DELIVERY_SIGNING_SECRET/);
  });

  it("rejects a non-isolated previous crew key before durable V2 minting", async () => {
    vi.stubEnv("NODE_ENV", "development");
    clearSigningEnv();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    process.env.RATE_LIMIT_SALT = "stable-rate-limit-secret-0123456789abcdef";
    process.env.CREW_DELIVERY_SIGNING_SECRET = "current-crew-delivery-secret-0123456789abcdef";
    process.env.CREW_DELIVERY_PREVIOUS_SIGNING_SECRET = process.env.CREW_DELIVERY_SIGNING_SECRET;
    const analytics = await import("@/lib/verifiedAnalytics.server");

    expect(() => analytics.crewCommittedEventToken({
      crewCommittedEventId: crewEventId,
      crewCommittedAt: occurredAt,
      issuedAt,
    })).toThrow(/CREW_DELIVERY_PREVIOUS_SIGNING_SECRET.*CREW_DELIVERY_SIGNING_SECRET/);
  });

  it("preserves RATE_LIMIT_SALT as the existing Plan mutation root", async () => {
    vi.stubEnv("NODE_ENV", "development");
    clearSigningEnv();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    const rateLimitSalt = "existing-plan-root-0123456789abcdef";
    process.env.RATE_LIMIT_SALT = rateLimitSalt;
    const plans = await import("@/lib/planStore");

    expect(plans.planIdempotencyDigest("plan-test", "mutation-key")).toBe(
      createHmac("sha256", rateLimitSalt).update("plan-test:mutation-key").digest("hex"),
    );
  });

  it("discards a real legacy v1 crew token while preserving v1 for other events", async () => {
    vi.stubEnv("NODE_ENV", "development");
    clearSigningEnv();
    process.env.PLAN_IDEMPOTENCY_SECRET = "legacy-v1-signing-secret-0123456789abcdef";
    const analytics = await import("@/lib/verifiedAnalytics.server");
    const claims = {
      v: 1,
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "crew_committed",
      props: { participants: 2, routeReady: true, source: "shared-plan" },
      issuedAt,
      expiresAt: issuedAt + 30 * 24 * 60 * 60 * 1_000,
    };
    const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
    const legacySignature = createHmac("sha256", process.env.PLAN_IDEMPOTENCY_SECRET)
      .update(`verified-analytics:v1:${encoded}`)
      .digest("base64url");
    const legacyCrewToken = `${encoded}.${legacySignature}`;

    expect(analytics.verifyAnalyticsDeliveryToken(legacyCrewToken, crewEvent, issuedAt + 1_000)).toBeNull();
    const other = analytics.mintVerifiedAnalyticsToken(analyticsEvent, "plan:legacy-v1", occurredAt);
    expect(analytics.verifyAnalyticsDeliveryToken(other, analyticsEvent, issuedAt + 1_000)).not.toBeNull();
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
