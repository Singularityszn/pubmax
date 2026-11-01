// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "owner-token" }));

const viewer = vi.hoisted(() => ({ handle: null as string | null }));
const track = vi.hoisted(() => vi.fn());
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => viewer.handle }));
vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics")>()),
  trackEvent: track,
}));

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
    // Only the clock is faked, so the year read back is always 2026 and the
    // month always October, whatever day the suite runs on.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T12:00:00.000Z"));
    window.localStorage.clear();
    viewer.handle = null;
    fetchMock.mockReset();
    track.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    host?.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function seedYear() {
    viewer.handle = "ripley-fan";
    window.localStorage.setItem(NIGHTS_KEPT_STORAGE_KEY, JSON.stringify({
      version: 1, days: ["2026-02-20", "2026-10-03", "2026-10-17"], lastPlanId: null,
    }));
    window.localStorage.setItem(CRAWL_PROGRESS_KEY, JSON.stringify({
      crawls: {
        one: { stopIds: ["pub-x", "pub-a"], visited: ["pub-x", "pub-a"], startedAt: "2026-02-20T19:00:00.000Z", completedAt: "2026-02-20T22:00:00.000Z" },
        two: { stopIds: ["pub-a", "pub-z"], visited: ["pub-a", "pub-z"], startedAt: "2026-10-17T19:00:00.000Z", completedAt: "2026-10-17T22:00:00.000Z" },
      },
    }));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/pint-drops/stats?handle=ripley-fan&year=2026") {
        return Response.json({ stats: { pintsMapped: 12, byBorough: [{ borough: "Camden" }, { borough: "Hackney" }, { borough: "Islington" }] } });
      }
      if (url === "/api/venue/pub-a") return Response.json({ venue: { name: "The Crown" } });
      if (url === "/api/venue/pub-x") return Response.json({ venue: { name: "The Lamb" } });
      return new Response(null, { status: 404 });
    });
  }

  async function click(target: Element | null | undefined) {
    expect(target).toBeTruthy();
    await act(async () => {
      (target as HTMLElement).click();
    });
    for (let turn = 0; turn < 4; turn += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  function button(name: string): HTMLButtonElement | undefined {
    return [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name);
  }

  it("asks the person to go out first when the device holds no year yet", async () => {
    await render();
    expect(host.querySelector("#pal-year-title")?.textContent).toBe("Your year so far");
    expect(host.querySelector(".palYearEmpty")?.textContent).toBe("Our year starts with your first night out. Ripley will keep it here.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(button("Share my year")).toBeUndefined();
  });

  it("reads the device, the person's own stats and the pub names it needs", async () => {
    const year = 2026;
    viewer.handle = "ripley-fan";
    window.localStorage.setItem(NIGHTS_KEPT_STORAGE_KEY, JSON.stringify({ version: 1, days: [`${year}-03-07`], lastPlanId: null }));
    window.localStorage.setItem(CRAWL_PROGRESS_KEY, JSON.stringify({
      crawls: {
        one: { stopIds: ["pub-a", "pub-b"], visited: ["pub-a", "pub-b"], startedAt: `${year}-02-20T19:00:00.000Z`, completedAt: `${year}-02-20T22:00:00.000Z` },
      },
    }));
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/pint-drops/stats?handle=ripley-fan&year=2026") {
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
      "/api/pint-drops/stats?handle=ripley-fan&year=2026",
      expect.objectContaining({ headers: { authorization: "Bearer owner-token" } }),
    );
    expect(host.querySelector(".palYearNote")?.textContent).toBe("Read from this device and your own mapped prices. Only you see it until you share it.");
  });

  it("reads as the Year in Pints in December", async () => {
    vi.setSystemTime(new Date("2026-12-05T12:00:00.000Z"));
    seedYear();
    await render();
    expect(host.querySelector("#pal-year-title")?.textContent).toBe("Your Year in Pints");
  });

  it("shares only the lines the person ticks, and the counts start ticked", async () => {
    seedYear();
    const share = vi.fn<(data: { title: string; text: string; url: string }) => Promise<void>>(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    await render();

    const open = button("Share my year");
    expect(open?.getAttribute("aria-expanded")).toBe("false");
    await click(open);
    expect(open?.getAttribute("aria-expanded")).toBe("true");

    const rows = [...host.querySelectorAll<HTMLLabelElement>(".palYearShareRow")];
    expect(rows.map((row) => [row.textContent, row.querySelector("input")?.checked])).toEqual([
      ["3 nights out.", true],
      ["October was the busiest month.", true],
      ["4 stops walked.", true],
      ["Kept coming back to The Crown. 2 crawls in all.", false],
      ["First night out: 20 February, at The Lamb.", false],
      ["12 prices mapped across 3 boroughs. Every one helps the next person.", true],
    ]);

    // Tick the first night, untick the prices.
    await click(rows[4]!.querySelector("input"));
    await click(rows[5]!.querySelector("input"));
    await click(button("Share the card"));

    expect(share).toHaveBeenCalledTimes(1);
    const sent = share.mock.calls[0]![0];
    const url = new URL(sent.url);
    expect(url.pathname).toBe("/year-in-pints/2026");
    expect(Object.fromEntries(url.searchParams)).toEqual({ to: "10", n: "3", m: "10", s: "4", fd: "02-20", fs: "pub-x" });
    expect(sent.title).toBe("My 2026 so far");
    expect(sent.text).toBe("My 2026 so far: 3 nights out, 4 stops walked. Read yours on PUBMAXX.");
    expect(sent.url).not.toMatch(/ripley|handle|pub-a/);
    expect(track).toHaveBeenCalledWith("content_shared", { channel: "native", surface: "year" });
    expect(host.textContent).toContain("Sent. Only the lines you ticked went with it.");
  });

  it("will not share an empty card", async () => {
    seedYear();
    await render();
    await click(button("Share my year"));
    for (const input of host.querySelectorAll<HTMLInputElement>(".palYearShareRow input")) {
      if (input.checked) await click(input);
    }
    expect(button("Share the card")?.disabled).toBe(true);
    expect(host.textContent).toContain("Tick a line to share the card.");
    expect(host.querySelector(".palYearShareActions a")).toBeNull();
  });

  it.each(["missing", "failed", "pending"])("withholds the first-night checkbox when its venue name is %s", async (state) => {
    seedYear();
    const seededFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string) => {
      if (url !== "/api/venue/pub-x") return seededFetch(url);
      if (state === "failed") throw new Error("offline");
      if (state === "pending") return new Promise<Response>(() => {});
      return new Response(null, { status: 404 });
    });
    const share = vi.fn<(data: { url: string }) => Promise<void>>(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    await render();
    await click(button("Share my year"));
    expect([...host.querySelectorAll(".palYearShareRow")].some((row) => row.textContent?.startsWith("First night out:"))).toBe(false);
    await click(button("Share the card"));
    const sent = new URL(share.mock.calls[0]![0].url);
    expect(sent.searchParams.has("fd")).toBe(false);
    expect(sent.searchParams.has("fs")).toBe(false);
  });

  it("shares a date-only checkbox without a location", async () => {
    seedYear();
    window.localStorage.removeItem(CRAWL_PROGRESS_KEY);
    const share = vi.fn<(data: { url: string }) => Promise<void>>(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    await render();
    await click(button("Share my year"));
    const first = [...host.querySelectorAll(".palYearShareRow")].find((row) => row.textContent === "First night out: 20 February.");
    await click(first?.querySelector("input"));
    await click(button("Share the card"));
    const sent = new URL(share.mock.calls[0]![0].url);
    expect(sent.searchParams.get("fd")).toBe("02-20");
    expect(sent.searchParams.has("fs")).toBe(false);
  });

  it("shares the busiest month after every other count is unticked", async () => {
    seedYear();
    const share = vi.fn<(data: { url: string }) => Promise<void>>(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    await render();
    await click(button("Share my year"));
    for (const row of host.querySelectorAll(".palYearShareRow")) {
      const input = row.querySelector<HTMLInputElement>("input")!;
      if (input.checked && row.textContent !== "October was the busiest month.") await click(input);
    }
    await click(button("Share the card"));
    const sent = new URL(share.mock.calls[0]![0].url);
    expect(sent.search).toBe("?to=10&m=10");
  });
});
