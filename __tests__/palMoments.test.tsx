// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/map" }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import PalCheer, { palCheerLine } from "@/components/pal/PalCheer";
import PubPalSummon, { PAL_SUMMON_CHEER_MS, palSummonCheerLine } from "@/components/pubpal/PubPalSummon";
import { announcePalMoment, subscribePalMoments, type PalMoment } from "@/lib/palMoments";
import { DEFAULT_PAL_DRAFT, type PubPal } from "@/lib/pubPal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pal(overrides: Partial<PubPal> = {}): PubPal {
  const now = "2026-10-04T12:00:00.000Z";
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: "owner", name: "Ripley", adultAttestedAt: now,
    appearance: DEFAULT_PAL_DRAFT.appearance, personality: DEFAULT_PAL_DRAFT.personality, voice: DEFAULT_PAL_DRAFT.voice,
    muted: false, hidden: false, proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    ...overrides,
  } as PubPal;
}

function store(value: PubPal) {
  window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(value));
}

let root: Root | null = null;
let host: HTMLElement;

async function render(element: React.ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(element);
  });
  // The stored Pal is read after mount.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
});

describe("Pal moments", () => {
  it("delivers a moment to every listener in the tab", () => {
    const heard: PalMoment[] = [];
    const stop = subscribePalMoments((moment) => heard.push(moment));
    announcePalMoment({ kind: "crawl-finished", stops: 3 });
    stop();
    announcePalMoment({ kind: "night-finished", stops: 4 });
    expect(heard).toEqual([{ kind: "crawl-finished", stops: 3 }]);
  });

  it("ignores anything outside the closed list", () => {
    const heard: PalMoment[] = [];
    const stop = subscribePalMoments((moment) => heard.push(moment));
    window.dispatchEvent(new CustomEvent("pubmax:pal-moment", { detail: { kind: "level-up", stops: 3 } }));
    window.dispatchEvent(new CustomEvent("pubmax:pal-moment", { detail: { kind: "crawl-finished", stops: -1 } }));
    announcePalMoment({ kind: "crawl-finished", stops: 2.5 });
    stop();
    expect(heard).toEqual([]);
  });

  it("says what happened, never a score", () => {
    expect(palCheerLine("Ripley", "crawl-finished", 3)).toBe("Ripley walked all 3 stops with you.");
    expect(palCheerLine("Ripley", "crawl-finished", 1)).toBe("Ripley walked it with you.");
    expect(palCheerLine("Ripley", "night-finished", 4)).toBe("Ripley saw the whole night through with you.");
    expect(palSummonCheerLine({ kind: "crawl-finished", stops: 3 })).toBe("Walked all 3 stops");
    expect(palSummonCheerLine({ kind: "night-finished", stops: 3 })).toBe("That's the night");
    for (const line of [palCheerLine("Ripley", "crawl-finished", 3), palSummonCheerLine({ kind: "crawl-finished", stops: 3 })]) {
      expect(line).not.toMatch(/\b(level|xp|points?|streak|score)\b/i);
    }
  });
});

describe("the Pal's cheer in a celebration", () => {
  it("shows the person's own Pal with its line", async () => {
    store(pal());
    await render(createElement(PalCheer, { moment: "crawl-finished", stops: 3 }));
    const cheer = host.querySelector("[data-testid='pal-cheer']")!;
    expect(cheer.textContent).toBe("Ripley walked all 3 stops with you.");
    expect(cheer.querySelector(".palCheerFace")!.getAttribute("aria-hidden")).toBe("true");
    expect(cheer.querySelectorAll(".palCheerSparks i")).toHaveLength(8);
    expect(cheer.getAttribute("data-pal-state")).toBeNull();
  });

  it("shows nothing with no Pal, or a hidden one, and a muted Pal stays still", async () => {
    await render(createElement(PalCheer, { moment: "crawl-finished", stops: 3 }));
    expect(host.innerHTML).toBe("");
    act(() => root!.unmount());
    store(pal({ hidden: true }));
    await render(createElement(PalCheer, { moment: "crawl-finished", stops: 3 }));
    expect(host.innerHTML).toBe("");
    act(() => root!.unmount());
    store(pal({ muted: true }));
    await render(createElement(PalCheer, { moment: "night-finished", stops: 3 }));
    expect(host.querySelector("[data-testid='pal-cheer']")!.getAttribute("data-pal-state")).toBe("sleeping");
    root!.unmount();
    root = null;
  });
});

describe("the summon chip on a moment", () => {
  it("jumps and says what happened, then goes back to its offer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    store(pal());
    await render(createElement(PubPalSummon));
    const chip = host.querySelector<HTMLAnchorElement>(".palSummon")!;
    expect(chip.querySelector("small")!.textContent).toBe("Tap to talk or plan");
    act(() => announcePalMoment({ kind: "crawl-finished", stops: 3 }));
    expect(chip.classList.contains("isCheering")).toBe(true);
    expect(chip.querySelector("small")!.textContent).toBe("Walked all 3 stops");
    // The link's name stays the summon; the line is announced as a status.
    expect(chip.getAttribute("aria-label")).toBe("Summon Ripley, your Pub Pal");
    act(() => vi.advanceTimersByTime(PAL_SUMMON_CHEER_MS));
    expect(chip.classList.contains("isCheering")).toBe(false);
    expect(chip.querySelector("small")!.textContent).toBe("Tap to talk or plan");
  });
});
