import { describe, expect, it, vi } from "vitest";

import { dispatchStepOutNudges, type StepOutNudgeDispatchDeps } from "@/lib/stepOutNudgeDispatch.server";
import { walkNudgeJob, type NudgeCursor } from "@/lib/nudgeJobCursor.server";
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
  it("resumes from the last completed recipient after the time budget", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
      let cursor: string | null = null;
      const checkpoint: NudgeCursor = {
        claim: async () => ({ cursor }),
        advance: async (_job, _lease, next) => { cursor = next; },
      };
      const rows = [pref({ ownerActor: "a" }), pref({ ownerActor: "b" })];
      const list = async (after: string | null) => rows.filter((row) => !after || row.ownerActor > after);
      const visited: string[] = [];
      expect(await walkNudgeJob("step-out", list, async (row) => {
        visited.push(row.ownerActor);
        vi.setSystemTime(new Date("2026-08-08T12:00:51Z"));
      }, checkpoint)).toBe(false);
      expect(cursor).toBe("a");
      expect(await walkNudgeJob("step-out", list, async (row) => { visited.push(row.ownerActor); }, checkpoint)).toBe(true);
      expect(visited).toEqual(["a", "b"]);
      expect(cursor).toBeNull();
    } finally { vi.useRealTimers(); }
  });
  it("reaches recipients beyond the first ordered page", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => pref({ ownerActor: `actor-${String(i).padStart(2, "0")}` }));
    const deps: StepOutNudgeDispatchDeps = {
      listEnabled: async (after?: string | null) => rows.filter((row) => !after || row.ownerActor > after).slice(0, 25),
      resolveAccountId: async () => "user-1",
      selectPayload: async () => ({ kind: "soft_plan_open", title: "Weekly nudge", body: "A plan is open.", url: "/tonight" }),
      send: async () => ({ sent: 1, pruned: 0, errors: 0 }),
      claim: vi.fn(async () => true),
      release: vi.fn(),
    };
    expect((await dispatchStepOutNudges(new Date("2026-08-08T12:00:00.000Z"), deps)).sent).toBe(26);
  });
  it("skips when nothing is owed and never sends filler", async () => {
    const send = vi.fn();
    const deps: StepOutNudgeDispatchDeps = {
      listEnabled: async (after) => after ? [] : [pref()],
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
      listEnabled: async (after) => after ? [] : [
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
      listEnabled: async (after) => after ? [] : [pref()],
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
