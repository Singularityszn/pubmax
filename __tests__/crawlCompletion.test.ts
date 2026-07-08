import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CRAWL_PROGRESS_KEY,
  completedCrawlCount,
  isComplete,
  markCrawlComplete,
  markStopVisited,
  parseProgress,
  readCrawl,
  readProgress,
  startCrawl,
} from "@/lib/crawlCompletion";

type WindowLike = { localStorage: Storage };

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

function makeThrowingStorage(): Storage {
  const boom = () => {
    throw new Error("SecurityError: storage disabled");
  };
  return {
    length: 0,
    clear: boom,
    getItem: boom,
    key: boom,
    removeItem: boom,
    setItem: boom,
  } as unknown as Storage;
}

function installWindow(storage: Storage): void {
  (globalThis as { window?: WindowLike }).window = { localStorage: storage };
}

function clearWindow(): void {
  delete (globalThis as { window?: WindowLike }).window;
}

beforeEach(() => {
  clearWindow();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-08T20:00:00.000Z"));
});

afterEach(() => {
  clearWindow();
  vi.useRealTimers();
});

describe("parseProgress", () => {
  it("returns empty for junk", () => {
    expect(parseProgress(null)).toEqual({ crawls: {} });
    expect(parseProgress("nope")).toEqual({ crawls: {} });
    expect(parseProgress({ crawls: "bad" })).toEqual({ crawls: {} });
  });

  it("normalises stop/visited ids and drops unknown visits", () => {
    const parsed = parseProgress({
      crawls: {
        " river-run ": {
          stopIds: [" a ", "b", "a", ""],
          visited: ["b", "ghost", " a "],
          startedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    expect(parsed.crawls["river-run"]).toEqual({
      stopIds: ["a", "b"],
      visited: ["b", "a"],
      startedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("startCrawl / markStopVisited / isComplete", () => {
  it("starts a crawl, tracks visits, and completes when all stops are visited", () => {
    const storage = makeMemoryStorage();
    const started = startCrawl("southbank", ["v1", "v2", "v3"], storage);
    expect(started).toMatchObject({
      stopIds: ["v1", "v2", "v3"],
      visited: [],
      startedAt: "2026-07-08T20:00:00.000Z",
    });
    expect(isComplete(started)).toBe(false);

    markStopVisited("southbank", "v1", storage);
    markStopVisited("southbank", "v2", storage);
    expect(isComplete(readCrawl("southbank", storage))).toBe(false);

    const done = markStopVisited("southbank", "v3", storage);
    expect(isComplete(done)).toBe(true);
    expect(done?.completedAt).toBe("2026-07-08T20:00:00.000Z");
    expect(completedCrawlCount(storage)).toBe(1);
  });

  it("ignores visits for unknown crawls or off-route venues", () => {
    const storage = makeMemoryStorage();
    expect(markStopVisited("missing", "v1", storage)).toBeNull();
    startCrawl("loop", ["v1"], storage);
    const same = markStopVisited("loop", "other", storage);
    expect(same?.visited).toEqual([]);
  });

  it("markCrawlComplete fills every stop", () => {
    const storage = makeMemoryStorage();
    startCrawl("quick", ["a", "b"], storage);
    const done = markCrawlComplete("quick", storage);
    expect(done?.visited).toEqual(["a", "b"]);
    expect(isComplete(done)).toBe(true);
  });

  it("restarting a crawl clears prior progress", () => {
    const storage = makeMemoryStorage();
    startCrawl("again", ["a", "b"], storage);
    markStopVisited("again", "a", storage);
    const restarted = startCrawl("again", ["a", "b", "c"], storage);
    expect(restarted?.visited).toEqual([]);
    expect(restarted?.stopIds).toEqual(["a", "b", "c"]);
    expect(restarted?.completedAt).toBeUndefined();
  });

  it("rejects blank ids / empty stop lists", () => {
    const storage = makeMemoryStorage();
    expect(startCrawl("", ["a"], storage)).toBeNull();
    expect(startCrawl("x", [], storage)).toBeNull();
  });
});

describe("storage seam", () => {
  it("reads from window.localStorage when no storage arg is passed", () => {
    const storage = makeMemoryStorage();
    installWindow(storage);
    startCrawl("windowed", ["p1", "p2"]);
    expect(readProgress().crawls.windowed?.stopIds).toEqual(["p1", "p2"]);
    expect(storage.getItem(CRAWL_PROGRESS_KEY)).toContain("windowed");
  });

  it("fail-softs when storage throws or window is missing", () => {
    expect(readProgress(null)).toEqual({ crawls: {} });
    // No storage → still returns the in-memory entry (write is a no-op).
    expect(startCrawl("x", ["a"], null)).toMatchObject({ stopIds: ["a"], visited: [] });
    expect(startCrawl("y", ["a"], makeThrowingStorage())).toMatchObject({
      stopIds: ["a"],
    });
    // No window → default storage resolves to null.
    expect(readProgress()).toEqual({ crawls: {} });
  });
});
