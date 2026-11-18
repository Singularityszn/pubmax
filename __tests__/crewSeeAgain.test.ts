import { describe, expect, it } from "vitest";
import { nextSeeAgainView, parseSeeAgain, seeAgainWindow } from "@/lib/crewSeeAgain";
import { OPEN_CRAWL_ARRIVAL_CLOSE_MS } from "@/lib/nightWindows";

describe("private see-again policy and view", () => {
  it("opens at the shared attendance close and closes 72 hours later", () => {
    expect(seeAgainWindow(0)).toEqual({ opensAt: OPEN_CRAWL_ARRIVAL_CLOSE_MS, closesAt: OPEN_CRAWL_ARRIVAL_CLOSE_MS + 72 * 3600_000 });
  });
  it("drops prior account data immediately and rejects stale completion", () => {
    const ready = nextSeeAgainView({ phase: "loading", scope: "a" }, { type: "loaded", scope: "a", data: { open: true, closesAt: "2026-11-20T00:00:00Z", items: [] } });
    const refreshing = nextSeeAgainView(ready, { type: "reset", scope: "a" });
    expect(refreshing).toEqual({ ...ready, phase: "refreshing" });
    const switched = nextSeeAgainView(ready, { type: "reset", scope: "b" });
    expect(switched).toEqual({ phase: "loading", scope: "b" });
    expect(nextSeeAgainView(switched, { type: "loaded", scope: "a", data: { open: true, closesAt: "2026-11-20T00:00:00Z", items: [] } })).toBe(switched);
  });
  it("treats malformed data as unavailable rather than an empty result", () => {
    expect(parseSeeAgain({ open: true, closesAt: "invalid", items: [] })).toBeNull();
    expect(parseSeeAgain({ open: true, closesAt: "2026-11-20T00:00:00Z", items: [{ memberId: "bad", handle: "bob", choice: "none", mutual: true }] })).toBeNull();
  });
});
