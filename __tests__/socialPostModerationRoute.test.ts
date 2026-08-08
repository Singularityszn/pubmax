import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: 0, requeueCalls: 0, purgeCalls: 0 }));

vi.mock("@/lib/socialPostStore", () => ({
  socialPostStore: () => ({
    processModerationQueue: async () => {
      state.calls += 1;
      return { processed: 2, approved: 1, needsReview: 0, retried: 1, terminalErrors: 1 };
    },
    requeueTerminalModeration: async () => {
      state.requeueCalls += 1;
      return 3;
    },
    inspectModerationBacklog: async () => ({
      pending: 1,
      strandedTerminal: 1,
      oldestPendingAgeMs: 45 * 60 * 1000,
    }),
  }),
}));
vi.mock("@/lib/socialModerationNotify", () => ({
  notifySocialModerationFindings: (
    backlog: { pending: number; strandedTerminal: number; oldestPendingAgeMs: number | null },
    lastRun?: { terminalErrors?: number },
  ) => ({
    findings: [
      {
        kind: "stranded_terminal",
        detail: "stranded",
        ...backlog,
        ...(lastRun?.terminalErrors ? { terminalErrors: lastRun.terminalErrors } : {}),
      },
    ],
  }),
}));
vi.mock("@/lib/socialPostModeration", () => ({
  OpenAISocialPostModerationAdapter: class {
    constructor() {
      if (!(process.env.OPENAI_API_KEY ?? "").trim()) {
        throw new Error("OpenAI moderation is not configured.");
      }
    }
  },
}));
vi.mock("@/lib/socialPostMedia.server", () => ({
  purgeDetachedSocialPhotos: async () => {
    state.purgeCalls += 1;
    return 4;
  },
}));

import { GET } from "@/app/api/cron/moderate-social-posts/route";

function request(token?: string, action?: string) {
  const query = action ? `?action=${action}` : "";
  return new Request(`http://localhost/api/cron/moderate-social-posts${query}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  state.calls = 0;
  state.requeueCalls = 0;
  state.purgeCalls = 0;
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
      terminalErrors: 1,
      backlog: {
        pending: 1,
        strandedTerminal: 1,
        oldestPendingAgeMs: 45 * 60 * 1000,
      },
      findings: [
        {
          kind: "stranded_terminal",
          detail: "stranded",
          pending: 1,
          strandedTerminal: 1,
          oldestPendingAgeMs: 45 * 60 * 1000,
          terminalErrors: 1,
        },
      ],
    });
    expect(state.calls).toBe(1);
    expect(state.purgeCalls).toBe(0);
  });

  it("refuses before claiming jobs when OpenAI moderation is not configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const response = await GET(request("cron-secret"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Social post moderation queue is unavailable.",
      code: "UNAVAILABLE",
      retryable: true,
    });
    expect(state.calls).toBe(0);
  });

  it("requeues terminal holds only through the authenticated operator action", async () => {
    const response = await GET(request("cron-secret", "requeue-terminal"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, requeued: 3 });
    expect(state.requeueCalls).toBe(1);
    expect(state.calls).toBe(0);
    expect(state.purgeCalls).toBe(0);
  });

  it("runs detached media cleanup through the authenticated operator action", async () => {
    const response = await GET(request("cron-secret", "purge-detached-media"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, purged: 4 });
    expect(state.purgeCalls).toBe(1);
    expect(state.calls).toBe(0);
  });
});
