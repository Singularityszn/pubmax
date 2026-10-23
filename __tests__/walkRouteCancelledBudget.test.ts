import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  charged: 0,
  refundFails: false,
  reserved: undefined as (() => void) | undefined,
  finish: undefined as (() => void) | undefined,
}));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/lib/supabase", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/supabase")>(),
  isSupabaseConfigured: () => true,
  checkRateLimitDurableDetailed: async (key: string) => {
    if (key.startsWith("ors-global:")) {
      state.reserved?.();
      await new Promise<void>((resolve) => { state.finish = resolve; });
      state.charged += 1;
    }
    return { verdict: false };
  },
}));
vi.mock("@/lib/walkRouteStore", () => ({
  walkRouteStore: () => ({ getLeg: async () => null, putLeg: async () => {} }),
}));
vi.mock("@/lib/rateLimitRefund.server", () => ({
  refundRateLimitHit: async () => { if (state.refundFails) return false; state.charged -= 1; return true; },
}));

import { GET } from "@/app/api/walk-route/route";
import { reserveRateLimit } from "@/lib/pintDrops";

beforeEach(() => { state.refundFails = false; state.charged = 0; state.reserved = undefined; state.finish = undefined; });

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("does not charge a provider call cancelled while the durable reservation is pending", async () => {
  vi.stubEnv("ORS_API_KEY", "test-key");
  const provider = vi.fn();
  vi.stubGlobal("fetch", provider);
  const waiting = new Promise<void>((resolve) => { state.reserved = resolve; });
  const controller = new AbortController();
  const response = GET(new Request("http://localhost/api/walk-route?stops=-0.1,51.5;-0.11,51.51", { signal: controller.signal }));
  await waiting;
  controller.abort();
  state.finish?.();
  expect(await (await response).json()).toMatchObject({ source: "straight" });
  expect(provider).not.toHaveBeenCalled();
  expect(state.charged).toBe(0);
});

it("returns an unused reservation once if cancellation arrives after the wait", async () => {
  const controller = new AbortController();
  const waiting = new Promise<void>((resolve) => { state.reserved = resolve; });
  const pending = reserveRateLimit("ors-global:test", 2, 86_400_000, controller.signal);
  await waiting;
  state.finish?.();
  const reservation = await pending;
  expect(reservation).not.toBeNull();
  controller.abort();
  expect(reservation?.commit()).toBe(false);
  await reservation?.release();
  await reservation?.release();
  expect(state.charged).toBe(0);
});

it("keeps a dispatched call charged when its caller later cancels", async () => {
  const controller = new AbortController();
  const waiting = new Promise<void>((resolve) => { state.reserved = resolve; });
  const pending = reserveRateLimit("ors-global:test", 2, 86_400_000, controller.signal);
  await waiting;
  state.finish?.();
  const reservation = await pending;
  expect(reservation?.commit()).toBe(true);
  controller.abort();
  await reservation?.release();
  await reservation?.release();
  expect(state.charged).toBe(1);
});

it("retains the charge and reports safely when a cancelled request cannot refund", async () => {
  state.refundFails = true;
  vi.stubEnv("ORS_API_KEY", "test-key");
  const provider = vi.fn();
  vi.stubGlobal("fetch", provider);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const waiting = new Promise<void>((resolve) => { state.reserved = resolve; });
  const controller = new AbortController();
  const pending = GET(new Request("http://localhost/api/walk-route?stops=-0.1,51.5;-0.11,51.51", { signal: controller.signal }));
  await waiting;
  controller.abort();
  state.finish?.();
  expect(await (await pending).json()).toMatchObject({ source: "straight" });
  expect(provider).not.toHaveBeenCalled();
  expect(state.charged).toBe(1);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toEqual({
    level: "error", event: "rate_limit.refund_failed", ts: expect.any(Number),
  });
});
