// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TonightLane from "@/components/map/TonightLane";
import { tonightPubListingCount } from "@/lib/tonightOutListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const NOW = Date.parse("2026-10-24T12:00:00.000Z");
let container: HTMLDivElement;
let root: Root;

function listing(id: string, changes: Partial<WhatsOnRow> = {}): WhatsOnRow {
  return {
    id, venueId: "venue-test-arms", placeName: "The Test Arms", kind: "quiz",
    title: "Fresh quiz", startsAt: "2026-10-24T19:00:00.000Z",
    observedAt: "2026-10-24T08:00:00.000Z", confidence: "listed",
    source: { label: "The Test Arms", url: "https://example.com/quiz" }, ...changes,
  };
}

function rawRows(): WhatsOnRow[] {
  return [
    ...Array.from({ length: 37 }, (_, index) => listing(`theatre-${index}`, { venueId: undefined, title: `Theatre ${index}` })),
    listing("old-quiz", { title: "Old quiz", observedAt: "2026-10-07T08:00:00.000Z" }),
    listing("old-music", { title: "Old music", kind: "music", observedAt: "2026-10-07T08:00:00.000Z" }),
  ];
}

function render(rows: WhatsOnRow[], pins = 0, open?: boolean, options: Partial<ComponentProps<typeof TonightLane>> = {}) {
  act(() => root.render(createElement(TonightLane, {
    rows, asOf: new Date(NOW).toISOString(), status: "ready", onSelectVenue: vi.fn(),
    overlayCount: pins, onToggleOverlay: vi.fn(), open, ...options,
  })));
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("map Tonight pub eligibility", () => {
  it("hides 39 raw rows when no pub listing is eligible", () => {
    const rows = rawRows();
    expect(rows).toHaveLength(39);
    expect(tonightPubListingCount(rows, NOW)).toBe(0);
    render(rows);
    expect(container.textContent).toBe("");
  });

  it("keeps seven Pins separate from zero eligible pub listings", () => {
    render(rawRows(), 7);
    expect(container.querySelector('[data-testid="tonight-lane-chip"]')).toBeNull();
    expect(container.textContent).toContain("Pins");
    expect(container.textContent).toContain("7");
    expect(container.textContent).not.toContain("39");
  });

  it("explains an empty open lane while keeping the Pins action", () => {
    render(rawRows(), 7, true);
    expect(container.querySelector('[role="status"]')?.textContent)
      .toContain("Nothing listed on tonight near you right now.");
    expect(container.querySelectorAll(".tonightLaneCard")).toHaveLength(0);
    expect(container.textContent).toContain("Pins");
    expect(container.textContent).toContain("7");
  });

  it("counts fresh pub listings once and opens only eligible cards and facets", () => {
    const fresh = listing("fresh");
    const rows = [...rawRows(), fresh, { ...fresh, id: "duplicate" }];
    expect(tonightPubListingCount(rows, NOW)).toBe(1);
    render(rows);
    const chip = container.querySelector<HTMLButtonElement>('[data-testid="tonight-lane-chip"]');
    expect(chip?.textContent).toContain("Pub listings tonight · 1");
    expect(chip?.textContent).toContain("via What's-on");
    act(() => chip!.click());
    expect(container.querySelectorAll(".tonightLaneCard")).toHaveLength(1);
    expect(container.textContent).toContain("Fresh quiz");
    expect(container.textContent).not.toContain("Old quiz");
    expect(container.textContent).not.toContain("Old music");
    expect(container.textContent).not.toContain("Theatre");
    expect(container.querySelector('[data-kind="music"]')).toBeNull();
  });

  describe.each(["map", "sheet"] as const)("%s category recovery", (variant) => {
    function clearCategory() {
      const all = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent === "All");
      expect(all).toBeDefined();
      expect(all?.getAttribute("aria-pressed")).toBe("false");
      act(() => all!.click());
      expect(container.querySelector('button[data-kind][aria-pressed="true"]')).toBeNull();
    }

    function expectEmptyCategory() {
      expect(container.querySelectorAll(".tonightLaneCard")).toHaveLength(0);
      expect(container.querySelector('[role="status"]')?.textContent)
        .toContain("Nothing listed in this category tonight via What's-on.");
      expect(container.textContent).not.toContain("Nothing listed on tonight near you right now.");
    }

    it("lets a music link clear stale music and reveal the fresh quiz", () => {
      render([...rawRows(), listing("fresh")], 7, true, { variant, initialKind: "music" });
      expectEmptyCategory();
      expect(container.textContent).toContain("Pins");
      expect(container.textContent).toContain("7");
      expect(container.textContent).toContain("via What's-on");
      clearCategory();
      expect(container.querySelector('[role="status"]')).toBeNull();
      expect(container.querySelectorAll(".tonightLaneCard")).toHaveLength(1);
      expect(container.textContent).toContain("Fresh quiz");
      expect(container.textContent).not.toContain("Old music");
      expect(container.textContent).not.toContain("Theatre");
      expect(container.querySelector('[data-kind="music"]')).toBeNull();
    });

    it("preserves a chosen category and offers All when refresh removes it", () => {
      const music = listing("fresh-music", { kind: "music", title: "Fresh music" });
      const quiz = listing("fresh-quiz");
      render([music, quiz], 0, true, { variant });
      const musicFilter = container.querySelector<HTMLButtonElement>('button[data-kind="music"]');
      expect(musicFilter).not.toBeNull();
      act(() => musicFilter!.click());
      expect(musicFilter?.getAttribute("aria-pressed")).toBe("true");
      expect(container.querySelectorAll(".tonightLaneCard")).toHaveLength(1);
      expect(container.textContent).toContain("Fresh music");
      expect(container.textContent).not.toContain("Fresh quiz");
      render([quiz], 0, true, { variant });
      expectEmptyCategory();
      clearCategory();
      expect(container.querySelectorAll(".tonightLaneCard")).toHaveLength(1);
      expect(container.textContent).toContain("Fresh quiz");
      expect(container.textContent).not.toContain("Fresh music");
    });

    it("keeps All available when refresh removes every eligible listing", () => {
      render([listing("music", { kind: "music" })], 0, true, { variant, initialKind: "music" });
      expect(container.querySelectorAll(".tonightLaneCard")).toHaveLength(1);
      render(rawRows(), 0, true, { variant, initialKind: "music" });
      expectEmptyCategory();
      clearCategory();
      expect(container.querySelectorAll(".tonightLaneCard")).toHaveLength(0);
      if (variant === "sheet") {
        expect(container.querySelector('[role="status"]')?.textContent)
          .toContain("Nothing listed on tonight near you right now.");
      } else {
        expect(container.textContent).toBe("");
      }
    });
  });
});
