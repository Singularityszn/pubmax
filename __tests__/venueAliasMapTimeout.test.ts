import { afterEach, describe, expect, it, vi } from "vitest";

// A deep-link sheet waits on the alias read, so a stalled alias file has to
// settle as "unread" instead of never answering (review of PR 2042).

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("loadVenueAliasMaps", () => {
  it("settles as unread when an alias file stalls", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "TimeoutError")),
            );
          }),
      ),
    );
    const { loadVenueAliasMaps } = await import("@/lib/venueAliasMap");
    const answer = loadVenueAliasMaps();
    await vi.advanceTimersByTimeAsync(10_000);
    const maps = await answer;
    expect(maps.read).toBe(false);
    expect(maps.aliases.size).toBe(0);
  });
});
