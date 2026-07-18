import { afterEach, describe, expect, it, vi } from "vitest";

// The provider seam (lib/pushProvider.ts): env-based selection mirrors
// storeBackend.selectStore. No live APNs — we drive selection with vi.stubEnv,
// exactly like the guard tests do for Supabase env in this suite.
import {
  apnsPushProvider,
  isApnsConfigured,
  noopPushProvider,
  selectPushProvider,
} from "@/lib/pushProvider";

const APNS_ENV = {
  APNS_KEY_ID: "KEY123",
  APNS_TEAM_ID: "TEAM456",
  APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
};

function stubApnsEnv(): void {
  for (const [k, v] of Object.entries(APNS_ENV)) vi.stubEnv(k, v);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isApnsConfigured", () => {
  it("is false unless all three APNs keys are present", () => {
    vi.stubEnv("APNS_KEY_ID", APNS_ENV.APNS_KEY_ID);
    vi.stubEnv("APNS_TEAM_ID", APNS_ENV.APNS_TEAM_ID);
    // Missing APNS_PRIVATE_KEY.
    expect(isApnsConfigured()).toBe(false);
  });

  it("is true when every APNs key is set", () => {
    stubApnsEnv();
    expect(isApnsConfigured()).toBe(true);
  });
});

describe("selectPushProvider", () => {
  it("chooses the no-op provider when APNs is unconfigured", () => {
    expect(selectPushProvider()).toBe(noopPushProvider);
  });

  it("chooses the APNs provider once its env keys exist", () => {
    stubApnsEnv();
    expect(selectPushProvider()).toBe(apnsPushProvider);
  });
});

describe("noopPushProvider", () => {
  it("reports every token as skipped, in input order, and never throws", async () => {
    const results = await noopPushProvider.send(
      ["tok-a", "tok-b"],
      { title: "T", body: "B" },
    );
    expect(results).toEqual([
      { token: "tok-a", status: "skipped", reason: "apns_not_configured" },
      { token: "tok-b", status: "skipped", reason: "apns_not_configured" },
    ]);
  });

  it("returns [] for no tokens", async () => {
    expect(await noopPushProvider.send([], { title: "T", body: "B" })).toEqual([]);
  });
});

describe("apnsPushProvider (stub)", () => {
  it("throws a not-configured error when env keys are missing", async () => {
    await expect(apnsPushProvider.send(["tok"], { title: "T", body: "B" }))
      .rejects.toThrow(/APNS_KEY_ID, APNS_TEAM_ID and APNS_PRIVATE_KEY/);
  });

  it("throws a not-implemented error when configured but transport is a pending drop-in", async () => {
    stubApnsEnv();
    await expect(apnsPushProvider.send(["tok"], { title: "T", body: "B" }))
      .rejects.toThrow(/not implemented yet/);
  });
});
