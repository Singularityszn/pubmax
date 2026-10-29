import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoContentEnabled, demoDrinksEnabled } from "@/lib/demoContent";
import { demoDropsFor, demoPintDropsForCity } from "@/lib/pintDropSeeds";
import { ambientPresenceCurve } from "@/lib/ambientPresence";

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("PUBMAX_ANALYTICS_ENVIRONMENT", undefined);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT", undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("production demo content", () => {
  it("inlines the production demo refusal into the browser build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("PUBMAX_ANALYTICS_ENVIRONMENT", "internal-test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT", "1");
    vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", "on");
    vi.resetModules();
    // @ts-expect-error -- no declaration file for the JS config module.
    const { default: config } = await import("@/next.config.mjs");
    expect(config.env.NEXT_PUBLIC_DEMO_CONTENT).toBe("off");
    vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", config.env.NEXT_PUBLIC_DEMO_CONTENT);
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(demoPintDropsForCity("london")).toEqual([]);
  });

  it("keeps an internal-test config usable in its browser environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("PUBMAX_ANALYTICS_ENVIRONMENT", "internal-test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT", "1");
    vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", "on");
    vi.resetModules();
    // @ts-expect-error -- no declaration file for the JS config module.
    const { default: config } = await import("@/next.config.mjs");
    expect(config.env.NEXT_PUBLIC_DEMO_CONTENT).not.toBe("off");
    vi.stubEnv("PUBMAX_ANALYTICS_ENVIRONMENT", config.env.PUBMAX_ANALYTICS_ENVIRONMENT);
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(demoPintDropsForCity("london").length).toBeGreaterThan(0);
  });

  it("retains fixtures for the existing internal-test browser build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT", "1");
    vi.stubEnv("PUBMAX_ANALYTICS_ENVIRONMENT", "internal-test");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", undefined);
    expect(demoPintDropsForCity("london").length).toBeGreaterThan(0);
  });

  it("does not enable fixtures on a production deployment with internal-test flags", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_E2E_ALLOW_BOT", "1");
    vi.stubEnv("PUBMAX_ANALYTICS_ENVIRONMENT", "internal-test");
    vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", "on");
    expect(demoPintDropsForCity("london")).toEqual([]);
  });

  it("shows no seeded drops or invented presence without a deployment flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", undefined);
    expect(demoContentEnabled()).toBe(false);
    expect(demoPintDropsForCity("london")).toEqual([]);
    expect(demoDropsFor("venue-16pnwmm")).toEqual([]);
    expect(ambientPresenceCurve("venue-16pnwmm", new Date("2026-07-17T21:00:00Z"))).toBe(0);
  });

  it("does not enable seeded menu drinks through a drinks-only flag in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", undefined);
    vi.stubEnv("NEXT_PUBLIC_DEMO_DRINKS", "on");
    expect(demoDrinksEnabled()).toBe(false);
  });

  it("keeps production free of fixtures even when a fixture flag is present", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", "on");
    vi.stubEnv("NEXT_PUBLIC_DEMO_DRINKS", "on");
    expect(demoContentEnabled()).toBe(false);
    expect(demoDrinksEnabled()).toBe(false);
  });

  it("allows explicit fixtures in a nonproduction runtime", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_DEMO_CONTENT", "on");
    vi.stubEnv("NEXT_PUBLIC_DEMO_DRINKS", "on");
    expect(demoPintDropsForCity("london").length).toBeGreaterThan(0);
    expect(demoDrinksEnabled()).toBe(true);
  });
});
