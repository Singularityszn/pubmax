import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/lib/socialPostStore", () => ({
  socialPostStore: () => ({
    processModerationQueue: async () => {
      state.calls += 1;
      return { processed: 2, approved: 1, needsReview: 0, retried: 1 };
    },
  }),
}));
vi.mock("@/lib/socialPostModeration", () => ({
  OpenAISocialPostModerationAdapter: class {},
}));

import { GET } from "@/app/api/cron/moderate-social-posts/route";

function request(token?: string) {
  return new Request("http://localhost/api/cron/moderate-social-posts", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  state.calls = 0;
});

afterEach(() => vi.unstubAllEnvs());

describe("Social post moderation worker", () => {
  it("refuses an unauthenticated queue drain", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(state.calls).toBe(0);
  });

  it("drains the durable queue behind cron authentication", async () => {
    const response = await GET(request("cron-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      processed: 2,
      approved: 1,
      needsReview: 0,
      retried: 1,
    });
    expect(state.calls).toBe(1);
  });
});
