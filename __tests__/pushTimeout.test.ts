import { afterEach, describe, expect, it, vi } from "vitest";

import { pushFetch, withPushTimeout } from "@/lib/pushTimeout";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bounded push I/O", () => {
  it("aborts a join/unlink fetch at its hard deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })));
    const pending = pushFetch("/api/push-tokens/account", { method: "DELETE" }, 25);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("bounds service-worker/recovery promises that never settle", async () => {
    vi.useFakeTimers();
    const pending = withPushTimeout(new Promise<never>(() => {}), 25);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });
});
