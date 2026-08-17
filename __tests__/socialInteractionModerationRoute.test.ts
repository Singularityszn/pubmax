import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  drainShouldThrow: false,
  drainResult: {
    processed: 2,
    approved: 1,
    needsReview: 1,
    retried: 0,
    terminalErrors: 0,
  },
}));

const processModerationQueue = vi.fn(async () => {
  if (state.drainShouldThrow) {
    throw new Error("claim_social_interaction_moderation_jobs is unavailable");
  }
  return state.drainResult;
});

vi.mock("@/lib/cronAuth", () => ({ assertCronRequest: vi.fn(() => null) }));
vi.mock("@/lib/socialInteractionStore", () => ({
  socialInteractionStore: () => ({ processModerationQueue }),
}));
vi.mock("@/lib/socialPostModeration", () => ({
  isOpenAISocialModerationConfigured: () => Boolean((process.env.OPENAI_API_KEY ?? "").trim()),
  OpenAISocialPostModerationAdapter: class {},
}));

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  state.drainShouldThrow = false;
  state.drainResult = {
    processed: 2,
    approved: 1,
    needsReview: 1,
    retried: 0,
    terminalErrors: 0,
  };
  processModerationQueue.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("Social interaction moderation worker", () => {
  it("drains held comments and quotes through authenticated cron", async () => {
    const { GET } = await import("@/app/api/cron/moderate-social-interactions/route");
    const response = await GET(new Request("http://localhost/api/cron/moderate-social-interactions"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      processed: 2,
      approved: 1,
      needsReview: 1,
      retried: 0,
      terminalErrors: 0,
    });
    expect(processModerationQueue).toHaveBeenCalledWith(expect.anything(), 20);
  });

  it("skips before claiming jobs when OpenAI moderation is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const { GET } = await import("@/app/api/cron/moderate-social-interactions/route");
    const response = await GET(new Request("http://localhost/api/cron/moderate-social-interactions"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: "openai_not_configured" });
    expect(processModerationQueue).not.toHaveBeenCalled();
  });

  it("answers queue_empty when nothing is waiting", async () => {
    state.drainResult = {
      processed: 0,
      approved: 0,
      needsReview: 0,
      retried: 0,
      terminalErrors: 0,
    };
    const { GET } = await import("@/app/api/cron/moderate-social-interactions/route");
    const response = await GET(new Request("http://localhost/api/cron/moderate-social-interactions"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      skipped: "queue_empty",
      processed: 0,
      approved: 0,
      needsReview: 0,
      retried: 0,
      terminalErrors: 0,
    });
  });

  it("returns the house envelope when the store drain throws", async () => {
    state.drainShouldThrow = true;
    const { GET } = await import("@/app/api/cron/moderate-social-interactions/route");
    const response = await GET(new Request("http://localhost/api/cron/moderate-social-interactions"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Social interaction moderation is unavailable.",
      code: "UNAVAILABLE",
      retryable: true,
    });
  });

  it("schedules the held-interaction queue without request-owned background work", () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons).toContainEqual({
      path: "/api/cron/moderate-social-interactions",
      // Services audit 2026-08: every-minute invocations while social tables are empty.
      schedule: "*/10 * * * *",
    });
  });
});
