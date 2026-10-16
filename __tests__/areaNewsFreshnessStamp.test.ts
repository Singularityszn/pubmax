// THE AREA NEWS FRESHNESS STAMP DATES THE NEWEST FACT, NOT THE FILE.
//
// lib/areaNews.ts serves a fact for 21 days from its own observedAt. The
// registry dated area_news by the file's generatedAt, so a refresh that kept
// only old facts reset the clock: on 2026-10-16 the spine read 399h of a 504h
// budget and called the lane fresh, while the newest fact (2026-09-15) had
// left the window after 2026-10-06 and /api/area-news served nothing.
//
// The stamp is now `latestObservedAt`, the newest entry's observedAt, written
// by the refresh and held to the entries here. The budget is the serving
// window plus the day the last fact is still served, so the lane reads stale
// exactly when the window holds no fact.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { AREA_NEWS_MAX_AGE_DAYS, freshAreaNews, type AreaNewsEntry } from "@/lib/areaNews";
import { evaluateFreshness } from "@/scripts/check_freshness.mjs";
import { latestObservedAt, refreshAreaNews } from "@/scripts/refresh_area_news.mjs";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();
const dataset = JSON.parse(readFileSync(join(ROOT, "data/area_news.json"), "utf8")) as {
  generatedAt: string;
  latestObservedAt?: string;
  entries: AreaNewsEntry[];
};
const registry = JSON.parse(readFileSync(join(ROOT, "data/freshness_registry.json"), "utf8"));
const entry = registry.datasets.find((d: { id: string }) => d.id === "area_news");

async function gateStatus(now: string): Promise<string> {
  const { results } = await evaluateFreshness({
    registry: { version: registry.version, datasets: [entry] },
    now: new Date(now),
    rootDir: ROOT,
  });
  return defined(results[0]).status;
}

function dayAfter(date: string, days: number, time: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return `${at.toISOString().slice(0, 10)}T${time}Z`;
}

describe("area_news freshness stamp", () => {
  it("is the committed file's newest entry date", () => {
    expect(dataset.latestObservedAt).toBe(latestObservedAt(dataset.entries));
  });

  it("is what the registry reads, with a budget of the serving window", () => {
    expect(entry.stamp).toEqual({ kind: "field", pointer: "latestObservedAt" });
    expect(entry.stalenessBudgetHours).toBe((AREA_NEWS_MAX_AGE_DAYS + 1) * 24);
  });

  it("reads stale exactly when no committed fact can be served", async () => {
    const newest = defined(dataset.latestObservedAt);
    const lastServed = dayAfter(newest, AREA_NEWS_MAX_AGE_DAYS, "23:00:00");
    const firstEmpty = dayAfter(newest, AREA_NEWS_MAX_AGE_DAYS + 1, "01:00:00");

    expect(freshAreaNews(dataset.entries, { now: Date.parse(lastServed) }).length).toBeGreaterThan(0);
    expect(await gateStatus(lastServed)).not.toBe("stale");

    expect(freshAreaNews(dataset.entries, { now: Date.parse(firstEmpty) })).toEqual([]);
    expect(await gateStatus(firstEmpty)).toBe("stale");
  });

  it("is written by the refresh from the entries it keeps", async () => {
    const snapshot = await refreshAreaNews({
      now: Date.parse("2026-08-28T12:00:00Z"),
      queries: ["one"],
      knownAreas: new Set(["soho"]),
      searchFn: vi.fn().mockResolvedValue([
        { url: "https://news.example/current", published_at: "2026-08-28T08:00:00Z" },
      ]),
      fetchFn: vi.fn().mockResolvedValue({
        url: "https://news.example/current",
        published_at: "2026-08-28T08:00:00Z",
        content: JSON.stringify({
          area: "soho",
          kind: "opening",
          title: "Golden Lion (Soho) opens",
          detail: "Golden Lion (Soho) pub opened on 27 August 2026.",
        }),
      }),
      previousDataset: {
        version: 1,
        generatedAt: "2026-07-18T12:00:00Z",
        latestObservedAt: "2026-07-18",
        entries: [
          {
            id: "old-row",
            area: "soho",
            kind: "award",
            title: "Golden Lion (Soho) wins an award",
            detail: "Golden Lion (Soho) won an award on 18 July 2026.",
            sourceUrl: "https://archive.example/award",
            sourceName: "archive.example",
            observedAt: "2026-07-18",
          },
        ],
      },
      writeDataset: vi.fn(),
      logger: vi.fn(),
    });
    expect(snapshot.entries.length).toBe(2);
    expect(snapshot.latestObservedAt).toBe(latestObservedAt(snapshot.entries));
    expect((snapshot.latestObservedAt ?? "") > "2026-07-18").toBe(true);
  });

  it("takes the newest parseable date and ignores the rest", () => {
    expect(
      latestObservedAt([{ observedAt: "2026-09-01" }, { observedAt: "2026-09-15" }, { observedAt: "nope" }]),
    ).toBe("2026-09-15");
    expect(latestObservedAt([])).toBeNull();
  });
});
