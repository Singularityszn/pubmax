import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

const processModerationQueue = vi.fn(async () => ({
  processed: 2,
  approved: 1,
  needsReview: 1,
  retried: 0,
  terminalErrors: 0,
}));

vi.mock("@/lib/cronAuth", () => ({ assertCronRequest: vi.fn(() => null) }));
vi.mock("@/lib/socialInteractionStore", () => ({
  socialInteractionStore: () => ({ processModerationQueue }),
}));
vi.mock("@/lib/socialPostModeration", () => ({
  OpenAISocialPostModerationAdapter: class {},
}));

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
