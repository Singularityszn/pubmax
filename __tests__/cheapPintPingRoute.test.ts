import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/contributionIdentity.server", () => ({
  resolveContributionIdentity: vi.fn(),
}));
vi.mock("@/lib/pintDrops", () => ({
  isLimited: vi.fn(async () => false),
}));
vi.mock("@/lib/pushTokenStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pushTokenStore")>(
    "@/lib/pushTokenStore",
  );
  return {
    ...actual,
    pushTokenStore: () => actual.memoryPushTokenStore,
  };
});
vi.mock("@/lib/stepOutNudgeStore", async () => {
  const actual = await vi.importActual<typeof import("@/lib/stepOutNudgeStore")>(
    "@/lib/stepOutNudgeStore",
  );
  return {
    ...actual,
    stepOutNudgeStore: () => actual.memoryStepOutNudgeStore,
  };
});

import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import {
  __listMemoryPushTokens,
  __resetMemoryPushTokens,
} from "@/lib/pushTokenStore";
import {
  __resetStepOutNudgeStore,
  memoryStepOutNudgeStore,
} from "@/lib/stepOutNudgeStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";
import { GET, POST } from "@/app/api/cheap-pint-ping/route";

const ACTOR = "profile:66666666-6666-4666-8666-666666666666";
const TOKEN = encodeWebPushSubscription({
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/cheap-pint",
  expirationTime: null,
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
})!;

function authOk() {
  vi.mocked(resolveContributionIdentity).mockResolvedValue({
    ok: true,
    accountId: "user-cheap-pint",
    actor: ACTOR,
    handle: "cheap_pint",
  });
}

beforeEach(() => {
  __resetStepOutNudgeStore();
  __resetMemoryPushTokens();
  authOk();
});

describe("GET/POST /api/cheap-pint-ping", () => {
  it("answers the age gate on a read as data at 200, and a write as 409", async () => {
    // A read of your own settings on every profile load must not log a console
    // error for an account that has not tapped "I'm 18 or over" yet. The write
    // is still refused.
    vi.mocked(resolveContributionIdentity).mockResolvedValue({
      ok: false,
      accountId: "user-gated",
      body: {
        status: "adult_check_required",
        error: "Confirm you are 18 or over before contributing.",
      },
      httpStatus: 409,
    });
    const read = await GET(new Request("http://localhost/api/cheap-pint-ping"));
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual({
      status: "adult_check_required",
      error: "Confirm you are 18 or over before contributing.",
    });

    const write = await POST(
      new Request("http://localhost/api/cheap-pint-ping", {
        method: "POST",
        body: JSON.stringify({ action: "qualify" }),
      }),
    );
    expect(write.status).toBe(409);
  });

  it("returns default-off before qualify", async () => {
    const response = await GET(new Request("http://localhost/api/cheap-pint-ping"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      qualified: false,
      enabled: false,
      declined: false,
      canPrompt: false,
    });
  });

  it("qualifies, opts in, and declines durably", async () => {
    const qualify = await POST(
      new Request("http://localhost/api/cheap-pint-ping", {
        method: "POST",
        body: JSON.stringify({ action: "qualify" }),
      }),
    );
    expect(qualify.status).toBe(200);
    await expect(qualify.json()).resolves.toMatchObject({
      qualified: true,
      canPrompt: true,
    });

    const optIn = await POST(
      new Request("http://localhost/api/cheap-pint-ping", {
        method: "POST",
        body: JSON.stringify({ action: "opt-in", token: TOKEN }),
      }),
    );
    expect(optIn.status).toBe(200);
    await expect(optIn.json()).resolves.toMatchObject({
      enabled: true,
      canPrompt: false,
    });
    expect(__listMemoryPushTokens().some((row) => row.token === TOKEN)).toBe(true);

    const decline = await POST(
      new Request("http://localhost/api/cheap-pint-ping", {
        method: "POST",
        body: JSON.stringify({ action: "decline" }),
      }),
    );
    expect(decline.status).toBe(200);
    await expect(decline.json()).resolves.toMatchObject({
      declined: true,
      enabled: false,
      canPrompt: false,
    });
    const stored = await memoryStepOutNudgeStore.get(ACTOR);
    expect(stored?.cheapPintDeclined).toBe(true);
  });
});
