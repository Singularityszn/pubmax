import { describe, expect, it, vi } from "vitest";

import { dispatchStepOutNudges, type StepOutNudgeDispatchDeps } from "@/lib/stepOutNudgeDispatch.server";
import type { StepOutNudgePref } from "@/lib/stepOutNudgeStore";

const ACTOR = "profile:44444444-4444-4444-8444-444444444444";
const TOKEN = "webpush:dispatch-token";

function pref(partial: Partial<StepOutNudgePref> = {}): StepOutNudgePref {
  return {
    ownerActor: ACTOR,
    enabled: true,
    subscriptionToken: TOKEN,
    lastSentAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    cheapPintQualified: false,
    cheapPintEnabled: false,
    cheapPintDeclined: false,
    cheapPintSentAt: null,
    ...partial,
  };
}

describe("dispatchStepOutNudges", () => {
  it("skips when nothing is owed and never sends filler", async () => {
    const send = vi.fn();
    const deps: StepOutNudgeDispatchDeps = {
      listEnabled: async () => [pref()],
      resolveAccountId: async () => "user-1",
      selectPayload: async () => null,
      send,
      claim: vi.fn(async () => true),
      release: vi.fn(),
    };
    const summary = await dispatchStepOutNudges(new Date("2026-08-08T12:00:00.000Z"), deps);
    expect(summary.skippedNothingOwed).toBe(1);
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("respects the weekly frequency stamp", async () => {
    const send = vi.fn();
    const deps: StepOutNudgeDispatchDeps = {
      listEnabled: async () => [
        pref({ lastSentAt: "2026-08-07T12:00:00.000Z" }),
      ],
      resolveAccountId: async () => "user-1",
      selectPayload: async () => ({
        kind: "soft_plan_open",
        title: "Weekly nudge",
        body: "Your plan for tonight is still open.",
        url: "/tonight",
      }),
      send,
      claim: vi.fn(async () => true),
      release: vi.fn(),
    };
    const summary = await dispatchStepOutNudges(new Date("2026-08-08T12:00:00.000Z"), deps);
    expect(summary.skippedFrequency).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("claims last_sent, then sends an owed payload", async () => {
    const claim = vi.fn(async () => true);
    const release = vi.fn();
    const deps: StepOutNudgeDispatchDeps = {
      listEnabled: async () => [pref()],
      resolveAccountId: async () => "user-1",
      selectPayload: async () => ({
        kind: "soft_plan_open",
        title: "Weekly nudge",
        body: "Your plan for tonight is still open.",
        url: "/tonight",
      }),
      send: async () => ({ sent: 1, pruned: 0, errors: 0 }),
      claim,
      release,
    };
    const now = new Date("2026-08-08T12:00:00.000Z");
    const summary = await dispatchStepOutNudges(now, deps);
    expect(summary.sent).toBe(1);
    expect(claim).toHaveBeenCalledWith(ACTOR, now.toISOString(), "2026-08-01T12:00:00.000Z");
    expect(release).not.toHaveBeenCalled();
  });
});
