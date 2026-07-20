import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PUSH_RESPONSE_MAX_BYTES,
  pushFetch,
  withPushTimeout,
} from "@/lib/pushTimeout";

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

  it("keeps the deadline armed while the response body is still streaming", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      pull: () => new Promise<void>(() => {}),
    }), { status: 200 })));
    const pending = pushFetch("/api/push-tokens/account", { method: "DELETE" }, 25);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("cancels a chunked response and aborts as soon as its cumulative body exceeds 64 KiB", async () => {
    const cancel = vi.fn();
    let requestSignal: AbortSignal | null | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(PUSH_RESPONSE_MAX_BYTES));
        controller.enqueue(new Uint8Array([1]));
        // Deliberately never close: a whole-body reader would hang here.
      },
      cancel,
    });
    vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
      requestSignal = init?.signal;
      return new Response(body, {
        status: 202,
        headers: { "x-push-test": "streamed" },
      });
    }));

    await expect(pushFetch("/api/push-tokens/account", { method: "DELETE" }, 1_000))
      .rejects.toThrow("Push response body is too large.");
    expect(cancel).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("rebuilds a bounded streamed response with its status and headers intact", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("bounded "));
        controller.enqueue(new TextEncoder().encode("body"));
        controller.close();
      },
    }), {
      status: 202,
      statusText: "Accepted",
      headers: { "x-push-test": "preserved" },
    })));

    const response = await pushFetch("/api/push-tokens/account", { method: "DELETE" });
    expect(response.status).toBe(202);
    expect(response.statusText).toBe("Accepted");
    expect(response.headers.get("x-push-test")).toBe("preserved");
    expect(await response.text()).toBe("bounded body");
  });

  it("bounds service-worker/recovery promises that never settle", async () => {
    vi.useFakeTimers();
    const pending = withPushTimeout(new Promise<never>(() => {}), 25);
    const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });
});
