import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetStepOutNudgeStore,
  memoryStepOutNudgeStore,
} from "@/lib/stepOutNudgeStore";
import { canSendStepOutNudge } from "@/lib/stepOutNudge";

const ACTOR = "profile:11111111-1111-4111-8111-111111111111";
const TOKEN = "webpush:e2e-sub";

describe("stepOutNudgeStore", () => {
  beforeEach(() => {
    __resetStepOutNudgeStore();
  });

  it("defaults to off and requires an explicit enable with a token", async () => {
    expect(await memoryStepOutNudgeStore.get(ACTOR)).toBeNull();
    const enabled = await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.subscriptionToken).toBe(TOKEN);
    expect(enabled.lastSentAt).toBeNull();
    expect(canSendStepOutNudge(enabled.lastSentAt)).toBe(true);
  });

  it("withdraw clears the subscription and disables the pref", async () => {
    await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });
    const withdrawn = await memoryStepOutNudgeStore.withdraw(ACTOR);
    expect(withdrawn.enabled).toBe(false);
    expect(withdrawn.subscriptionToken).toBeNull();
    expect(await memoryStepOutNudgeStore.listEnabled()).toEqual([]);
  });

  it("detaches a matching browser token from both personalized push lanes", async () => {
    await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });
    await memoryStepOutNudgeStore.qualifyCheapPint(ACTOR);
    await memoryStepOutNudgeStore.optInCheapPint(ACTOR, TOKEN);

    const detached = await memoryStepOutNudgeStore.detachSubscriptionToken(TOKEN);

    expect(detached).toBe(1);
    expect(await memoryStepOutNudgeStore.get(ACTOR)).toMatchObject({
      enabled: false,
      cheapPintEnabled: false,
      subscriptionToken: null,
    });
    expect(await memoryStepOutNudgeStore.listEnabled()).toEqual([]);
    expect(await memoryStepOutNudgeStore.listCheapPintSendReady()).toEqual([]);
  });

  it("does not detach a newer device token when an old device signs out", async () => {
    const newerToken = "webpush:newer-device";
    await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: newerToken,
    });
    await memoryStepOutNudgeStore.optInCheapPint(ACTOR, newerToken);

    const detached = await memoryStepOutNudgeStore.detachSubscriptionToken(TOKEN);

    expect(detached).toBe(0);
    expect(await memoryStepOutNudgeStore.get(ACTOR)).toMatchObject({
      enabled: true,
      cheapPintEnabled: true,
      subscriptionToken: newerToken,
    });
    expect(await memoryStepOutNudgeStore.listEnabled()).toHaveLength(1);
    expect(await memoryStepOutNudgeStore.listCheapPintSendReady()).toHaveLength(1);
  });

  it("detaches every historical account binding for the same browser token", async () => {
    const otherActor = "profile:33333333-3333-4333-8333-333333333333";
    await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });
    await memoryStepOutNudgeStore.optInCheapPint(ACTOR, TOKEN);
    await memoryStepOutNudgeStore.put(otherActor, {
      enabled: true,
      subscriptionToken: TOKEN,
    });

    const detached = await memoryStepOutNudgeStore.detachSubscriptionToken(TOKEN);

    expect(detached).toBe(2);
    expect(await memoryStepOutNudgeStore.listEnabled()).toEqual([]);
    expect(await memoryStepOutNudgeStore.listCheapPintSendReady()).toEqual([]);
  });

  it("markSent stamps the per-subscription frequency gate", async () => {
    await memoryStepOutNudgeStore.put(ACTOR, {
      enabled: true,
      subscriptionToken: TOKEN,
    });
    const sentAt = "2026-08-08T12:00:00.000Z";
    await memoryStepOutNudgeStore.markSent(ACTOR, sentAt);
    const pref = await memoryStepOutNudgeStore.get(ACTOR);
    expect(pref?.lastSentAt).toBe(sentAt);
    expect(canSendStepOutNudge(pref?.lastSentAt, Date.parse("2026-08-10T12:00:00.000Z"))).toBe(
      false,
    );
  });
});
