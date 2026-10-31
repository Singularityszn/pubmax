import { afterEach, expect, it, vi } from "vitest";
import { PAL_ERROR_FALLBACK } from "@/lib/palChat";

afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/lib/ask/router");
  vi.resetModules();
});

it("shows a recoverable error when the submitted question cannot load routing policy", async () => {
  vi.doMock("@/lib/ask/router", () => { throw new Error("Chunk unavailable"); });
  const { createPalChatSession } = await import("@/lib/palChatClient");
  const fetchImpl = vi.fn();
  const onTurns = vi.fn();
  const ask = createPalChatSession({ fetchImpl, onTurns });
  expect(await ask("Find pubs in Soho", "london")).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
  expect(fetchImpl).not.toHaveBeenCalled();
  expect(onTurns).not.toHaveBeenCalled();
});

it("includes policy loading in the deadline and never sends a question after timeout", async () => {
  let finish!: (policy: { refineRoutedAskQuery: (query: string) => string }) => void;
  const policy = new Promise<{ refineRoutedAskQuery: (query: string) => string }>((resolve) => { finish = resolve; });
  vi.doMock("@/lib/ask/router", () => policy);
  const { createPalChatSession } = await import("@/lib/palChatClient");
  vi.useFakeTimers();
  const fetchImpl = vi.fn();
  const ask = createPalChatSession({ fetchImpl, timeoutMs: 20 });
  const result = ask("Find pubs in Soho", "london");
  await vi.advanceTimersByTimeAsync(20);
  expect(await result).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
  finish({ refineRoutedAskQuery: (query) => query });
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchImpl).not.toHaveBeenCalled();
});
