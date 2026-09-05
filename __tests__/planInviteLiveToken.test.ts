// @vitest-environment jsdom

// Battle test M04: "New link" retired the invite token while the Send on
// WhatsApp href beside it still carried the old one, so a host who shared
// straight after rotating sent a link the server already refuses. One live
// token per Plan is the fix, and this is its contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPlanInviteToken,
  ensurePlanInviteToken,
  parsePlanInviteTokenSnapshot,
  planInviteTokenEvent,
  readPlanInviteTokenSnapshot,
  refreshPlanInviteToken,
  writePlanInviteToken,
} from "@/lib/planInviteTokenClient";

const PLAN = "6a7d6f2e-0c1a-4c4b-9c3d-1f2a3b4c5d6e";
const FIRST = "693fb655a1c34e7d8b0f2a1c4d5e6f70";
const ROTATED = "66a573f7b2d84f6ea1c3b5d7e9f0a1b2";

function snapshot() {
  return parsePlanInviteTokenSnapshot(readPlanInviteTokenSnapshot(PLAN));
}

function answerWith(body: unknown, ok = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 503,
      json: async () => body,
      body: null,
    } as unknown as Response),
  );
}

beforeEach(() => {
  clearPlanInviteToken(PLAN);
});

afterEach(() => {
  clearPlanInviteToken(PLAN);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the live invite token", () => {
  it("starts unknown, so no surface may claim a link it has not read", () => {
    expect(snapshot()).toEqual({ state: "unknown", token: null });
  });

  it("tells every watcher the moment a rotate writes the new token", () => {
    const heard: string[] = [];
    const listener = () => heard.push(readPlanInviteTokenSnapshot(PLAN));
    window.addEventListener(planInviteTokenEvent(PLAN), listener);

    writePlanInviteToken(PLAN, FIRST);
    writePlanInviteToken(PLAN, ROTATED);

    window.removeEventListener(planInviteTokenEvent(PLAN), listener);
    expect(heard).toEqual([`ready|${FIRST}`, `ready|${ROTATED}`]);
    expect(snapshot()).toEqual({ state: "ready", token: ROTATED });
  });

  it("reads the token from the capability-gated projection", async () => {
    answerWith({ inviteToken: FIRST });
    await expect(refreshPlanInviteToken(PLAN)).resolves.toBe(FIRST);
    expect(snapshot()).toEqual({ state: "ready", token: FIRST });
  });

  it("shares one request between the surfaces asking together", async () => {
    answerWith({ inviteToken: FIRST });
    const [a, b, c] = await Promise.all([
      refreshPlanInviteToken(PLAN),
      refreshPlanInviteToken(PLAN),
      ensurePlanInviteToken(PLAN),
    ]);
    expect([a, b, c]).toEqual([FIRST, FIRST, FIRST]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("spends no second read once a token is held", async () => {
    answerWith({ inviteToken: FIRST });
    await refreshPlanInviteToken(PLAN);
    await expect(ensurePlanInviteToken(PLAN)).resolves.toBe(FIRST);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("separates a projection with no token from a read that did not run", async () => {
    answerWith({});
    await expect(refreshPlanInviteToken(PLAN)).resolves.toBeNull();
    expect(snapshot()).toEqual({ state: "missing", token: null });

    clearPlanInviteToken(PLAN);
    answerWith({ error: "Plan data is temporarily unavailable." }, false);
    await expect(refreshPlanInviteToken(PLAN)).resolves.toBeNull();
    expect(snapshot()).toEqual({ state: "unavailable", token: null });

    clearPlanInviteToken(PLAN);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(refreshPlanInviteToken(PLAN)).resolves.toBeNull();
    expect(snapshot()).toEqual({ state: "unavailable", token: null });
  });

  it("re-asks after a read it could not run, rather than latching one blip for the page", async () => {
    // F-31: `unavailable` is not an answer about this Plan, so holding it
    // downgraded every share surface to a bare /plan/{id} link until a reload.
    answerWith({ error: "Plan data is temporarily unavailable." }, false);
    await expect(refreshPlanInviteToken(PLAN)).resolves.toBeNull();
    expect(snapshot()).toEqual({ state: "unavailable", token: null });

    answerWith({ inviteToken: FIRST });
    await expect(ensurePlanInviteToken(PLAN)).resolves.toBe(FIRST);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(snapshot()).toEqual({ state: "ready", token: FIRST });
  });

  it("spends no second read on a projection that answered with no token", async () => {
    answerWith({});
    await expect(refreshPlanInviteToken(PLAN)).resolves.toBeNull();
    expect(snapshot()).toEqual({ state: "missing", token: null });

    answerWith({ inviteToken: FIRST });
    await expect(ensurePlanInviteToken(PLAN)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("re-asks after a clear rather than sharing a token it no longer holds", async () => {
    answerWith({ inviteToken: FIRST });
    await refreshPlanInviteToken(PLAN);
    clearPlanInviteToken(PLAN);
    expect(snapshot()).toEqual({ state: "unknown", token: null });

    answerWith({ inviteToken: ROTATED });
    await expect(ensurePlanInviteToken(PLAN)).resolves.toBe(ROTATED);
  });

  it("reads a malformed snapshot as unknown", () => {
    expect(parsePlanInviteTokenSnapshot("")).toEqual({ state: "unknown", token: null });
    expect(parsePlanInviteTokenSnapshot("ready|")).toEqual({ state: "unknown", token: null });
    expect(parsePlanInviteTokenSnapshot("nonsense")).toEqual({ state: "unknown", token: null });
  });
});
