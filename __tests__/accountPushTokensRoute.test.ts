import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/authServer", () => ({ verifyCallerAuth: vi.fn() }));
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

import { DELETE } from "@/app/api/push-tokens/account/route";
import { verifyCallerAuth } from "@/lib/authServer";
import {
  __listMemoryPushTokens,
  __resetMemoryPushTokens,
  memoryPushTokenStore,
} from "@/lib/pushTokenStore";
import {
  __resetStepOutNudgeStore,
  memoryStepOutNudgeStore,
} from "@/lib/stepOutNudgeStore";
import { encodeWebPushSubscription } from "@/lib/webPushSubscription";

const ACTOR = "profile:profile-owner";
const PRIOR_ACTOR = "profile:prior-owner";
const TOKEN = encodeWebPushSubscription({
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/account-route",
  expirationTime: null,
  keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
})!;
const NEWER_TOKEN = encodeWebPushSubscription({
  endpoint: "https://updates.push.services.mozilla.com/wpush/v2/newer-device",
  expirationTime: null,
  keys: { p256dh: "C".repeat(87), auth: "D".repeat(22) },
})!;

function request(token = TOKEN): Request {
  return new Request("http://localhost/api/push-tokens/account", {
    method: "DELETE",
    headers: {
      authorization: "Bearer departing-access-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
}

beforeEach(() => {
  __resetMemoryPushTokens();
  __resetStepOutNudgeStore();
  vi.mocked(verifyCallerAuth).mockResolvedValue({
    status: "verified",
    identity: { id: "departing-user", email: null, createdAt: null },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DELETE /api/push-tokens/account", () => {
  it("withdraws both personalized lanes and removes the browser token", async () => {
    await memoryPushTokenStore.save({ token: TOKEN, platform: "web" });
    await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });
    await memoryStepOutNudgeStore.optInCheapPint(ACTOR, TOKEN);
    await memoryStepOutNudgeStore.put(PRIOR_ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(await memoryStepOutNudgeStore.get(ACTOR)).toMatchObject({
      enabled: false,
      cheapPintEnabled: false,
      subscriptionToken: null,
    });
    expect(await memoryStepOutNudgeStore.get(PRIOR_ACTOR)).toMatchObject({
      enabled: false,
      subscriptionToken: null,
    });
    expect(__listMemoryPushTokens()).toEqual([]);
  });

  it("preserves a newer device binding while removing the departing device token", async () => {
    await memoryPushTokenStore.save({ token: TOKEN, platform: "web" });
    await memoryPushTokenStore.save({ token: NEWER_TOKEN, platform: "web" });
    await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: NEWER_TOKEN,
    });
    await memoryStepOutNudgeStore.optInCheapPint(ACTOR, NEWER_TOKEN);

    const response = await DELETE(request(TOKEN));

    expect(response.status).toBe(200);
    expect(await memoryStepOutNudgeStore.get(ACTOR)).toMatchObject({
      enabled: true,
      cheapPintEnabled: true,
      subscriptionToken: NEWER_TOKEN,
    });
    expect(__listMemoryPushTokens().map((row) => row.token)).toEqual([NEWER_TOKEN]);
  });

  it("removes an unbound browser token without requiring a preference row", async () => {
    await memoryPushTokenStore.save({ token: TOKEN, platform: "web" });

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(__listMemoryPushTokens()).toEqual([]);
  });

  it("reports cleanup failure so the browser cannot trust the boundary", async () => {
    await memoryPushTokenStore.save({ token: TOKEN, platform: "web" });
    await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });
    vi.spyOn(memoryStepOutNudgeStore, "detachSubscriptionToken").mockRejectedValueOnce(
      new Error("store unavailable"),
    );

    const response = await DELETE(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "STORE_UNAVAILABLE" });
  });

  it("fails closed when caller authentication is unavailable", async () => {
    vi.mocked(verifyCallerAuth).mockResolvedValue({ status: "unavailable" });
    const response = await DELETE(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "AUTH_UNAVAILABLE" });
  });

  it("rejects an invalid or absent account bearer", async () => {
    vi.mocked(verifyCallerAuth).mockResolvedValue({ status: "invalid" });
    const response = await DELETE(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
