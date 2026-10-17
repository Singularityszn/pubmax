// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TONIGHT_YOUR_PUBS_LIMIT,
  tonightYourPubPicks,
  tonightYourPubsFoot,
} from "@/lib/tonightYourPubs";

/**
 * The "Your pubs" shelf on Tonight (lib/tonightYourPubs.ts,
 * app/tonight/TonightYourPubs.tsx). The pure picks, then the mounted shelf in
 * each of its read paths: an account's saves, this device's saves, and
 * nothing saved at all.
 */

const auth = { identityResolved: true };
let viewerHandle: string | null = null;
const fetchSavedForHandle = vi.fn();
const getSaved = vi.fn();
const warmVenueDetail = vi.fn();

vi.mock("@/components/auth/authContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => viewerHandle }));
vi.mock("@/lib/savedPubs", () => ({
  fetchSavedForHandle: (...args: unknown[]) => fetchSavedForHandle(...args),
  getSaved: () => getSaved(),
  SAVED_VENUE_FALLBACK_NAME: "A London venue",
}));
vi.mock("@/lib/warmVenueDetail", () => ({
  warmVenueDetail: (id: string) => warmVenueDetail(id),
}));

describe("tonightYourPubPicks", () => {
  it("keeps a pub once, under its newest save, newest first", () => {
    const { picks, total } = tonightYourPubPicks([
      { venueId: "a", listType: "Want to Visit", savedAt: "2026-10-01T10:00:00Z" },
      { venueId: "b", listType: "Cheap Pint", savedAt: "2026-10-03T10:00:00Z" },
      { venueId: "a", listType: "Date Night", savedAt: "2026-10-05T10:00:00Z" },
    ]);
    expect(total).toBe(2);
    expect(picks.map((p) => [p.venueId, p.listType])).toEqual([
      ["a", "Date Night"],
      ["b", "Cheap Pint"],
    ]);
  });

  it("holds the limit and counts every pub", () => {
    const saves = Array.from({ length: 7 }, (_, i) => ({
      venueId: `v${i}`,
      listType: "Want to Visit",
      savedAt: new Date(Date.UTC(2026, 9, i + 1)).toISOString(),
    }));
    const { picks, total } = tonightYourPubPicks(saves);
    expect(total).toBe(7);
    expect(picks).toHaveLength(TONIGHT_YOUR_PUBS_LIMIT);
    expect(picks[0]?.venueId).toBe("v6");
  });

  it("drops a save with no pub and an empty read is no rows", () => {
    expect(tonightYourPubPicks([{ venueId: "", listType: "x", savedAt: "" }])).toEqual({
      picks: [],
      total: 0,
    });
  });

  it("sends the foot link to the profile and counts what the shelf left out", () => {
    expect(tonightYourPubsFoot("sam", 9, 4)).toEqual({ href: "/u/sam", label: "All 9 saved pubs" });
    expect(tonightYourPubsFoot(null, 2, 2)).toEqual({ href: "/u/you", label: "Your lists" });
  });
});

describe("TonightYourPubs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    viewerHandle = null;
    auth.identityResolved = true;
    fetchSavedForHandle.mockReset();
    getSaved.mockReset();
    warmVenueDetail.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount() {
    const { default: TonightYourPubs } = await import("@/app/tonight/TonightYourPubs");
    await act(async () => {
      root.render(createElement(TonightYourPubs));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("draws nothing and asks for nothing when nothing is saved", async () => {
    getSaved.mockReturnValue([]);
    await mount();
    expect(container.innerHTML).toBe("");
    expect(fetchSavedForHandle).not.toHaveBeenCalled();
    expect(warmVenueDetail).not.toHaveBeenCalled();
  });

  it("waits for the session before it reads anything", async () => {
    auth.identityResolved = false;
    viewerHandle = null;
    getSaved.mockReturnValue([{ venueId: "a", listType: "Want to Visit", savedAt: "2026-10-01T00:00:00Z" }]);
    await mount();
    expect(getSaved).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("reads an account's saves with their names", async () => {
    viewerHandle = "sam";
    fetchSavedForHandle.mockResolvedValue([
      {
        venueId: "venue-1",
        venueName: "The Lamb",
        venueMapUrl: "/map?sel=venue-1",
        listType: "Want to Visit",
        savedAt: "2026-10-04T00:00:00Z",
      },
    ]);
    await mount();
    const rows = [...container.querySelectorAll(".tonightYourPubsRow")];
    expect(rows.map((row) => row.textContent)).toEqual(["The LambWant to Visit"]);
    expect(container.querySelector(".tonightYourPubsLink")?.getAttribute("href")).toBe("/map?sel=venue-1");
    expect(container.querySelector(".tonightYourPubsMore")?.getAttribute("href")).toBe("/u/sam");
    expect(container.textContent).not.toContain("Saved on this device.");
    expect(warmVenueDetail).not.toHaveBeenCalled();
  });

  it("leaves off an account save the index no longer names, and fills its row", async () => {
    viewerHandle = "sam";
    fetchSavedForHandle.mockResolvedValue(
      ["A London venue", "The Lamb", "The Harp", "The Devonshire", "Ye Olde Mitre"].map((name, index) => ({
        venueId: `venue-${index}`,
        venueName: name,
        venueMapUrl: `/map?sel=venue-${index}`,
        listType: "Want to Visit",
        savedAt: `2026-10-0${9 - index}T00:00:00Z`,
      })),
    );
    await mount();
    const names = [...container.querySelectorAll(".tonightYourPubsName")].map((node) => node.textContent);
    expect(names).toEqual(["The Lamb", "The Harp", "The Devonshire", "Ye Olde Mitre"]);
  });

  it("never draws one account's shelf for another", async () => {
    viewerHandle = "sam";
    let resolveSecond: (rows: unknown) => void = () => {};
    fetchSavedForHandle
      .mockResolvedValueOnce([
        { venueId: "venue-1", venueName: "Sam's Local", venueMapUrl: "/map?sel=venue-1", listType: "Want to Visit", savedAt: "2026-10-04T00:00:00Z" },
      ])
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    await mount();
    expect(container.textContent).toContain("Sam's Local");

    // The account switches; the new read is still running.
    viewerHandle = "alex";
    const { default: TonightYourPubs } = await import("@/app/tonight/TonightYourPubs");
    await act(async () => {
      root.render(createElement(TonightYourPubs));
    });
    expect(container.textContent).not.toContain("Sam's Local");

    await act(async () => {
      resolveSecond([
        { venueId: "venue-2", venueName: "Alex's Local", venueMapUrl: "/map?sel=venue-2", listType: "Want to Visit", savedAt: "2026-10-05T00:00:00Z" },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("Alex's Local");
    expect(container.textContent).not.toContain("Sam's Local");
  });

  it("names this device's saves from venue detail and never shows an id", async () => {
    getSaved.mockReturnValue([
      { venueId: "venue-open", listType: "Cheap Pint", savedAt: "2026-10-05T00:00:00Z" },
      { venueId: "venue-closed", listType: "Historic", savedAt: "2026-10-04T00:00:00Z" },
      { venueId: "venue-gone", listType: "Historic", savedAt: "2026-10-03T00:00:00Z" },
    ]);
    warmVenueDetail.mockImplementation(async (id: string) => {
      if (id === "venue-open") return { status: "found", venue: { id, name: "The Harp" } };
      if (id === "venue-closed") return { status: "found", venue: { id, name: "The Old Bell", retired: true } };
      return { status: "missing" };
    });
    await mount();
    const names = [...container.querySelectorAll(".tonightYourPubsName")].map((n) => n.textContent);
    expect(names).toEqual(["The Harp"]);
    expect(container.textContent).not.toContain("venue-");
    expect(container.textContent).toContain("Saved on this device.");
    expect(container.querySelector(".tonightYourPubsMore")?.textContent).toBe("All 3 saved pubs");
  });

  it("fills a row a closed or unnamed pub left, and still shows four at most", async () => {
    getSaved.mockReturnValue(
      Array.from({ length: 10 }, (_, i) => ({
        venueId: `venue-${i}`,
        listType: "Want to Visit",
        savedAt: new Date(Date.UTC(2026, 9, i + 1)).toISOString(),
      })),
    );
    // The newest save (venue-9) is gone from the map.
    warmVenueDetail.mockImplementation(async (id: string) =>
      id === "venue-9" ? { status: "missing" } : { status: "found", venue: { id, name: `Pub ${id}` } },
    );
    await mount();
    const names = [...container.querySelectorAll(".tonightYourPubsName")].map((n) => n.textContent);
    expect(names).toEqual(["Pub venue-8", "Pub venue-7", "Pub venue-6", "Pub venue-5"]);
    // Never more lookups than the cap, whatever is saved.
    expect(warmVenueDetail.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it("falls back to this device when the account read fails", async () => {
    viewerHandle = "sam";
    fetchSavedForHandle.mockResolvedValue(null);
    getSaved.mockReturnValue([{ venueId: "venue-open", listType: "Cheap Pint", savedAt: "2026-10-05T00:00:00Z" }]);
    warmVenueDetail.mockResolvedValue({ status: "found", venue: { id: "venue-open", name: "The Harp" } });
    await mount();
    expect(container.querySelector(".tonightYourPubsName")?.textContent).toBe("The Harp");
  });
});
