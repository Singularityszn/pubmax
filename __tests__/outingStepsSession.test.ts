// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearDeviceAccountSessionArtifacts } from "@/lib/deviceAccountIdentity";
import type { OutingStepsBridge } from "@/lib/nativeOutingSteps";
import { OUTING_STEPS_STORAGE_KEY, transitionOutingSteps, type OutingStepsState } from "@/lib/outingSteps";
import { beginOutingSteps, readOutingSteps, readOutingStepsEvent, writeOutingSteps } from "@/lib/outingStepsSession";

const T0 = Date.UTC(2026, 10, 14, 19, 0);
const OFF: OutingStepsState = { phase: "off" };
const TOKEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeBridge(overrides: Partial<OutingStepsBridge> = {}) {
  return {
    status: vi.fn(async () => ({ available: true, permission: "granted" as const })),
    requestPermission: vi.fn(async () => ({ available: true, permission: "granted" as const })),
    sample: vi.fn(async () => ({ platform: "android" as const, counter: 10_000, bootCount: 7, continuous: false })),
    stop: vi.fn(async () => {}),
    ...overrides,
  };
}

const shared = vi.hoisted(() => ({ bridge: null as OutingStepsBridge | null }));
vi.mock("@/lib/nativeOutingSteps", () => ({ loadOutingStepsBridge: async () => shared.bridge }));

async function startFor(owner: string | null, bridge: OutingStepsBridge, at = T0) {
  const outcome = await beginOutingSteps(bridge, { planId: "p1", owner, signal: new AbortController().signal, now: () => at });
  if (outcome.kind !== "started") throw new Error(`expected a start, got ${outcome.kind}`);
  const state = transitionOutingSteps(OFF, outcome.event);
  writeOutingSteps(state);
  return state;
}

beforeEach(() => {
  window.localStorage.clear();
  shared.bridge = null;
});

describe("private counts and account changes", () => {
  it("never shows one account's count to another account on the same Plan", async () => {
    const bridge = fakeBridge();
    shared.bridge = bridge;
    const started = await startFor("acct-a", bridge);
    if (started.phase !== "counting") throw new Error("expected counting");
    const counted = transitionOutingSteps(started, {
      type: "sample", session: started.session, at: T0 + 60_000, sample: { platform: "android", counter: 10_900, bootCount: 7, continuous: true },
    });
    writeOutingSteps(counted);

    expect(readOutingSteps("acct-a")).toMatchObject({ phase: "counting", steps: 900 });
    expect(readOutingSteps("acct-b")).toEqual(OFF);
    expect(readOutingSteps(null)).toEqual(OFF);

    clearDeviceAccountSessionArtifacts(window.sessionStorage);
    expect(window.localStorage.getItem(OUTING_STEPS_STORAGE_KEY)).toBeNull();
    await vi.waitFor(() => expect(bridge.stop).toHaveBeenCalledExactlyOnceWith({ session: started.session }));

    const joined = await startFor("acct-b", bridge, T0 + 120_000);
    expect(joined).toMatchObject({ phase: "counting", planId: "p1", owner: "acct-b", steps: 0 });
    expect(readOutingSteps("acct-a")).toEqual(OFF);
  });

  it("drops a start that resolves after the account changed and releases its listener", async () => {
    const pending = deferred<{ platform: "android"; counter: number; bootCount: number; continuous: boolean }>();
    const bridge = fakeBridge({ sample: vi.fn(() => pending.promise) });
    const account = new AbortController();
    const outcome = beginOutingSteps(bridge, { planId: "p1", owner: "acct-a", signal: account.signal, now: () => T0, mintSession: () => TOKEN_A });
    await vi.waitFor(() => expect(bridge.sample).toHaveBeenCalled());

    account.abort();
    pending.resolve({ platform: "android", counter: 10_000, bootCount: 7, continuous: false });

    await expect(outcome).resolves.toEqual({ kind: "stale" });
    expect(bridge.stop).toHaveBeenCalledExactlyOnceWith({ session: TOKEN_A });
    expect(window.localStorage.getItem(OUTING_STEPS_STORAGE_KEY)).toBeNull();
  });

  it("keeps the new account's stored count when an old start resolves after it began counting", async () => {
    const pending = deferred<{ platform: "android"; counter: number; bootCount: number; continuous: boolean }>();
    const oldBridge = fakeBridge({ sample: vi.fn(() => pending.promise) });
    const account = new AbortController();
    const outcome = beginOutingSteps(oldBridge, { planId: "p1", owner: "acct-a", signal: account.signal, now: () => T0, mintSession: () => TOKEN_A });
    await vi.waitFor(() => expect(oldBridge.sample).toHaveBeenCalled());

    account.abort();
    await startFor("acct-b", fakeBridge(), T0 + 5_000);
    pending.resolve({ platform: "android", counter: 10_000, bootCount: 7, continuous: false });

    await expect(outcome).resolves.toEqual({ kind: "stale" });
    expect(oldBridge.stop).toHaveBeenCalledExactlyOnceWith({ session: TOKEN_A });
    expect(readOutingSteps("acct-b")).toMatchObject({ phase: "counting", owner: "acct-b" });
  });

  it.each([
    ["a later millisecond", T0 + 5_000],
    ["the same millisecond", T0],
  ])("keeps a newer account's listener when its start reads %s", async (_label, newAt) => {
    let armed: Record<string, unknown> | null = null;
    let readings = 0;
    const oldReading = deferred<{ platform: "android"; counter: number; bootCount: number; continuous: boolean }>();
    const native = fakeBridge({
      sample: vi.fn((payload: Record<string, unknown>) => {
        readings += 1;
        const first = readings === 1;
        armed = { ...payload };
        return first ? oldReading.promise : Promise.resolve({ platform: "android" as const, counter: 500, bootCount: 7, continuous: false });
      }),
      stop: vi.fn(async (payload: Record<string, unknown>) => {
        if (armed && Object.entries(payload).every(([key, value]) => armed?.[key] === value)) armed = null;
      }),
    });
    const accountA = new AbortController();
    const oldStart = beginOutingSteps(native, { planId: "p1", owner: "acct-a", signal: accountA.signal, now: () => T0 });
    await vi.waitFor(() => expect(native.sample).toHaveBeenCalledOnce());

    accountA.abort();
    const newStart = await beginOutingSteps(native, { planId: "p1", owner: "acct-b", signal: new AbortController().signal, now: () => newAt });
    expect(newStart.kind).toBe("started");
    const newArmed = armed;
    oldReading.resolve({ platform: "android", counter: 10_000, bootCount: 7, continuous: false });

    await expect(oldStart).resolves.toEqual({ kind: "stale" });
    await vi.waitFor(() => expect(native.stop).toHaveBeenCalledOnce());
    expect(armed).not.toBeNull();
    expect(armed).toEqual(newArmed);
  });

  it("drops a permission answer that arrives after the account changed", async () => {
    const answer = deferred<{ available: boolean; permission: "granted" }>();
    const bridge = fakeBridge({
      status: vi.fn(async () => ({ available: true, permission: "prompt" as const })),
      requestPermission: vi.fn(() => answer.promise),
    });
    const account = new AbortController();
    const outcome = beginOutingSteps(bridge, { planId: "p1", owner: "acct-a", signal: account.signal, now: () => T0 });
    await vi.waitFor(() => expect(bridge.requestPermission).toHaveBeenCalled());

    account.abort();
    answer.resolve({ available: true, permission: "granted" });

    await expect(outcome).resolves.toEqual({ kind: "stale" });
    expect(bridge.sample).not.toHaveBeenCalled();
  });

  it("drops a reading that arrives after the account changed", async () => {
    const state = await startFor("acct-a", fakeBridge());
    const pending = deferred<{ platform: "android"; counter: number; bootCount: number; continuous: boolean }>();
    const bridge = fakeBridge({ sample: vi.fn(() => pending.promise) });
    const account = new AbortController();
    const outcome = readOutingStepsEvent(bridge, state, { signal: account.signal, now: () => T0 + 60_000 });
    await vi.waitFor(() => expect(bridge.sample).toHaveBeenCalled());

    account.abort();
    pending.resolve({ platform: "android", counter: 10_700, bootCount: 7, continuous: true });

    await expect(outcome).resolves.toEqual({ kind: "stale" });
    expect(bridge.stop).toHaveBeenCalledExactlyOnceWith({ session: state.phase === "counting" ? state.session : "" });
  });
});

describe("native expiry", () => {
  it("ends the session when the phone says the window has expired", async () => {
    const state = await startFor("acct-a", fakeBridge());
    const bridge = fakeBridge({ sample: vi.fn(async () => { throw Object.assign(new Error("expired"), { code: "expired" }); }) });
    const outcome = await readOutingStepsEvent(bridge, state, { signal: new AbortController().signal, now: () => T0 + 90_000 });
    expect(outcome).toEqual({ kind: "event", event: { type: "stop", session: state.phase === "counting" ? state.session : "", at: T0 + 90_000 } });
  });
});
