// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "owner-token" }));

const viewer = vi.hoisted(() => ({ handle: null as string | null }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => viewer.handle }));

import PalYear from "@/components/pal/PalYear";
import { CRAWL_PROGRESS_KEY } from "@/lib/crawlCompletion";
import { NIGHTS_KEPT_STORAGE_KEY } from "@/lib/nightsKept";
import { palYearFacts, palYearLines, type PalYearCrawl } from "@/lib/palYear";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function crawl(day: string, stopIds: string[], visited = stopIds): PalYearCrawl {
  return { stopIds, visited, startedAt: `${day}T19:00:00.000Z`, completedAt: `${day}T22:30:00.000Z` };
}

describe("the year's facts", () => {
  it("reads back only this year, and nothing at all from an empty device", () => {
    const empty = palYearFacts({ year: 2026, nightsKeptDays: [], crawls: [], contributions: null });
    expect(empty).toMatchObject({ nightsKept: 0, stopsWalked: 0, favourite: null, firstNight: null, pricesMapped: 0 });
    expect(palYearLines(empty, {})).toEqual([]);

    const facts = palYearFacts({
      year: 2026,
      nightsKeptDays: ["2025-12-31", "2026-03-07", "2026-10-03", "2026-10-17"],
      crawls: [crawl("2025-11-01", ["old-a", "old-b"]), crawl("2026-10-17", ["pub-a", "pub-b", "pub-c"])],
      contributions: null,
    });
    expect(facts.nightsKept).toBe(3);
    expect(facts.stopsWalked).toBe(3);
  });

  it("names the busiest month only when one month leads", () => {
    const lead = palYearFacts({ year: 2026, nightsKeptDays: ["2026-03-07", "2026-10-03", "2026-10-17"], crawls: [], contributions: null });
    expect(lead.busiestMonth).toBe("October");
    const tie = palYearFacts({ year: 2026, nightsKeptDays: ["2026-03-07", "2026-10-03"], crawls: [], contributions: null });
    expect(tie.busiestMonth).toBeNull();
  });

  it("counts only stops actually visited, and a pub as a favourite only across two crawls", () => {
    const once = palYearFacts({ year: 2026, nightsKeptDays: [], crawls: [crawl("2026-05-01", ["pub-a", "pub-b"], ["pub-a"])], contributions: null });
    expect(once.stopsWalked).toBe(1);
    expect(once.favourite).toBeNull();

    const twice = palYearFacts({
      year: 2026,
      nightsKeptDays: [],
      crawls: [crawl("2026-05-01", ["pub-a", "pub-b"]), crawl("2026-06-12", ["pub-c", "pub-a"]), crawl("2026-07-04", ["pub-a"])],
      contributions: null,
    });
    expect(twice.favourite).toEqual({ venueId: "pub-a", visits: 3 });
  });

  it("finds the first night, with its first stop when it was a crawl", () => {
    const facts = palYearFacts({
      year: 2026,
      nightsKeptDays: ["2026-04-11"],
      crawls: [crawl("2026-02-20", ["pub-x", "pub-y"])],
      contributions: null,
    });
    expect(facts.firstNight).toEqual({ day: "2026-02-20", firstStopVenueId: "pub-x" });
    const kept = palYearFacts({ year: 2026, nightsKeptDays: ["2026-01-09"], crawls: [crawl("2026-02-20", ["pub-x"])], contributions: null });
    expect(kept.firstNight).toEqual({ day: "2026-01-09", firstStopVenueId: null });
  });

  it("speaks one fact a line, and leaves out a pub with no known name", () => {
    const facts = palYearFacts({
      year: 2026,
      nightsKeptDays: ["2026-02-20", "2026-10-03", "2026-10-17"],
      crawls: [crawl("2026-02-20", ["pub-x", "pub-a"]), crawl("2026-10-17", ["pub-a", "pub-z"])],
      contributions: { pricesMapped: 12, boroughs: 3 },
    });
    expect(palYearLines(facts, { "pub-a": "The Crown", "pub-x": "The Lamb" })).toEqual([
      "We kept 3 nights together this year.",
      "October was our busiest month.",
      "We walked 4 stops.",
      "You kept coming back to The Crown. 2 crawls in all.",
      "Our first night was 20 February, starting at The Lamb.",
      "You have mapped 12 prices across 3 boroughs so far. Every one helps the next person.",
    ]);
    expect(palYearLines(facts, {})).toEqual([
      "We kept 3 nights together this year.",
      "October was our busiest month.",
      "We walked 4 stops.",
      "Our first night was 20 February.",
      "You have mapped 12 prices across 3 boroughs so far. Every one helps the next person.",
    ]);
  });

  it("never reads back a score: no streak, no rank, no pints drunk", () => {
    const facts = palYearFacts({
      year: 2026,
      nightsKeptDays: ["2026-10-03", "2026-10-04", "2026-10-05"],
      crawls: [crawl("2026-10-03", ["pub-a", "pub-b"])],
      contributions: { pricesMapped: 1, boroughs: 1 },
    });
    const text = palYearLines(facts, { "pub-a": "The Crown" }).join(" ");
    expect(text).not.toMatch(/streak|rank|level|points|pints? (drunk|had)|in a row|!/i);
    expect(text).toContain("3 nights");
    expect(text).toContain("one price");
  });
});

describe("the year on /pal", () => {
  let root: Root | null = null;
  let host: HTMLElement;
  const fetchMock = vi.fn();

  async function render() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(PalYear, { palName: "Ripley", print: Array.from({ length: 25 }, (_, index) => index % 3 === 0) }));
    });
    for (let turn = 0; turn < 6; turn += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  beforeEach(() => {
    window.localStorage.clear();
    viewer.handle = null;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    vi.unstubAllGlobals();
  });

  it("asks the person to go out first when the device holds no year yet", async () => {
    await render();
    expect(host.querySelector("#pal-year-title")?.textContent).toBe("Your year so far");
    expect(host.querySelector(".palYearEmpty")?.textContent).toBe("Our year starts with your first night out. Ripley will keep it here.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the device, the person's own stats and the pub names it needs", async () => {
    const year = new Date().getFullYear();
    viewer.handle = "ripley-fan";
    window.localStorage.setItem(NIGHTS_KEPT_STORAGE_KEY, JSON.stringify({ version: 1, days: [`${year}-03-07`], lastPlanId: null }));
    window.localStorage.setItem(CRAWL_PROGRESS_KEY, JSON.stringify({
      crawls: {
        one: { stopIds: ["pub-a", "pub-b"], visited: ["pub-a", "pub-b"], startedAt: `${year}-02-20T19:00:00.000Z`, completedAt: `${year}-02-20T22:00:00.000Z` },
      },
    }));
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/pint-drops/stats?handle=ripley-fan")) {
        return Response.json({ stats: { pintsMapped: 4, byBorough: [{ borough: "Camden", count: 4 }] } });
      }
      if (url === "/api/venue/pub-a") return Response.json({ venue: { name: "The Crown" } });
      return new Response(null, { status: 404 });
    });
    await render();
    const lines = [...host.querySelectorAll(".palYearLines li")].map((line) => line.textContent);
    expect(lines).toEqual([
      "We kept one night together this year.",
      "We walked 2 stops.",
      "Our first night was 20 February, starting at The Crown.",
      "You have mapped 4 prices so far. Every one helps the next person.",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/pint-drops/stats?handle=ripley-fan",
      expect.objectContaining({ headers: { authorization: "Bearer owner-token" } }),
    );
    expect(host.querySelector(".palYearNote")?.textContent).toBe("Read from this device and your own mapped prices. Only you see it.");
  });
});
