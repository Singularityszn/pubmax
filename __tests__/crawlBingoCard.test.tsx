// @vitest-environment jsdom

// Pub crawl bingo on the Night Mode card: it renders 3 of 9 from this night's
// records, offers the full house share line at 9 of 9, and a tap on a square
// ticks nothing, because a square is not a control.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanState } from "@/lib/plan";

const share = vi.hoisted(() => ({ calls: [] as { title: string; text: string; url: string }[] }));

vi.mock("@/lib/venuesSlim", () => ({
  loadSlimVenues: vi.fn().mockResolvedValue([
    { id: "lamb", name: "The Lamb", lat: 0, lng: 0, cheapestPrice: null, borough: "Camden" },
    {
      id: "anchor",
      name: "The Anchor",
      lat: 0,
      lng: 0,
      cheapestPrice: null,
      borough: "Southwark",
      filterHints: { searchText: "", amenities: { beerGarden: true, darts: true }, curation: {}, canonical: true },
    },
  ]),
}));
vi.mock("@/lib/shareSheet", () => ({
  shareNightObject: vi.fn(async (value: { title: string; text: string; url: string }) => {
    share.calls.push(value);
    return "shared";
  }),
}));

const { CrawlBingoCard } = await import("@/components/night/CrawlBingoCard");
const { resetCrawlBingoNotesForTest, noteCrawlBingoAction } = await import("@/lib/crawlBingoNightLog");

const PLAN = "11111111-1111-4111-8111-111111111111";

function plan(): PlanState {
  return {
    plan: { id: PLAN, title: "Brass Compass" },
    stops: [
      { venueId: "lamb", venueName: "The Lamb", position: 0 },
      { venueId: "anchor", venueName: "The Anchor", position: 1 },
    ],
    crew: [],
    actions: [],
  } as unknown as PlanState;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(props: { stopIndex: number; lastTrainVenueId: string | null; planState?: PlanState }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(CrawlBingoCard, {
        planId: PLAN,
        plan: props.planState ?? plan(),
        stopIndex: props.stopIndex,
        lastTrainVenueId: props.lastTrainVenueId,
      }),
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resetCrawlBingoNotesForTest();
  share.calls = [];
  window.localStorage.setItem(
    "pubmax_active_plan",
    JSON.stringify({ version: 1, id: PLAN, startTime: new Date().toISOString(), stopIndex: 0 }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.localStorage.clear();
});

function doneSquares(): string[] {
  return [...document.querySelectorAll("[data-square][data-done]")].map((el) => el.getAttribute("data-square") ?? "");
}

describe("CrawlBingoCard", () => {
  it("renders 3 of 9 from the night's records, and a tap on a square ticks nothing", async () => {
    // The cursor at the Anchor (a "Here now" tap) is an arrival at a garden
    // and a dartboard; the last-train read is the third.
    await render({ stopIndex: 1, lastTrainVenueId: "anchor" });
    expect(document.querySelector(".crawlBingo__count")?.textContent).toBe("3 of 9");
    expect(doneSquares().sort()).toEqual(["darts", "garden", "lastTrain"]);
    expect(document.querySelectorAll(".crawlBingo__square")).toHaveLength(9);
    expect(document.querySelector(".crawlBingo__square button")).toBeNull();

    const price = document.querySelector<HTMLElement>('[data-square="price"]')!;
    await act(async () => {
      price.click();
    });
    expect(document.querySelector(".crawlBingo__count")?.textContent).toBe("3 of 9");
    expect(document.querySelector(".crawlBingo__share")).toBeNull();
  });

  it("ticks a square when its action is noted for this plan while the card is open", async () => {
    await render({ stopIndex: 0, lastTrainVenueId: null });
    expect(document.querySelector(".crawlBingo__count")?.textContent).toBe("0 of 9");
    await act(async () => {
      noteCrawlBingoAction("price", "lamb");
    });
    expect(doneSquares()).toEqual(["price"]);
  });

  it("offers the full house line through the share seam at 9 of 9", async () => {
    for (const kind of ["price", "photo", "listed", "story", "oldest", "historyCard"] as const) {
      noteCrawlBingoAction(kind, "lamb");
    }
    await render({ stopIndex: 1, lastTrainVenueId: "lamb" });
    expect(document.querySelector(".crawlBingo__count")?.textContent).toBe("9 of 9");
    expect(document.querySelector(".crawlBingo__line")?.textContent).toBe("Full house at the Brass Compass");
    const button = document.querySelector<HTMLButtonElement>(".crawlBingo__share")!;
    await act(async () => {
      button.click();
    });
    expect(share.calls).toHaveLength(1);
    expect(share.calls[0]?.text).toBe("Full house at the Brass Compass");
  });

  it("renders nothing before the plan has arrived", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(CrawlBingoCard, { planId: PLAN, plan: null, stopIndex: 0, lastTrainVenueId: null }));
    });
    expect(host.innerHTML).toBe("");
  });
});
