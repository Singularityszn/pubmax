// @vitest-environment jsdom

// Night falls (wild idea 09). The app already turns dark at 21:30 London time
// for a reader with no stored theme choice; the wild switch makes that switch
// a moment, once a night in this browser. These hold the night's key, when
// the moment is due, where the lamps go, the toast's words, and the
// component's three ways in: the first load after 21:30, the rule turning an
// open page dark, and `?nightfall=now`, which never stores a theme choice.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NightFall from "@/components/wild/NightFall";
import NightFallGate from "@/components/wild/NightFallGate";
import {
  NIGHT_FALL_MS,
  NIGHT_FALL_STORAGE_KEY,
  NIGHT_FALL_TOAST,
  nightFallDue,
  nightFallKey,
  nightFallLamps,
} from "@/components/wild/nightFallPlan";
import { THEME_STORAGE_KEY } from "@/lib/themePreference";
import { WILD_MODE_STORAGE_KEY } from "@/lib/wildMode";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = document.documentElement;
let reducedMotion = false;

function stubMatchMedia(): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reducedMotion : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe("the night a moment belongs to", () => {
  it("starts at 21:30 London time and runs past midnight under the evening's date", () => {
    // 2 November is GMT, so London is UTC.
    expect(nightFallKey(new Date("2026-11-02T21:29:00Z"))).toBeNull();
    expect(nightFallKey(new Date("2026-11-02T21:30:00Z"))).toBe("2026-11-02");
    expect(nightFallKey(new Date("2026-11-03T02:10:00Z"))).toBe("2026-11-02");
    expect(nightFallKey(new Date("2026-11-03T04:00:00Z"))).toBeNull();
    // 30 June is BST: 21:30 in London is 20:30 UTC.
    expect(nightFallKey(new Date("2026-06-30T20:30:00Z"))).toBe("2026-06-30");
    // The first night of a month after midnight belongs to the month before.
    expect(nightFallKey(new Date("2026-12-01T01:00:00Z"))).toBe("2026-11-30");
  });

  it("is due only on a page the NIGHT RULE darkened, and once a night", () => {
    const now = new Date("2026-11-02T22:00:00Z");
    expect(nightFallDue({ nightTheme: true, theme: "dark", lastPlayedKey: null, now })).toBe("2026-11-02");
    expect(nightFallDue({ nightTheme: true, theme: "dark", lastPlayedKey: "2026-11-01", now })).toBe("2026-11-02");
    expect(nightFallDue({ nightTheme: true, theme: "dark", lastPlayedKey: "2026-11-02", now })).toBeNull();
    // A reader's own dark choice carries no night-theme mark.
    expect(nightFallDue({ nightTheme: false, theme: "dark", lastPlayedKey: null, now })).toBeNull();
    expect(nightFallDue({ nightTheme: true, theme: "light", lastPlayedKey: null, now })).toBeNull();
    expect(nightFallDue({ nightTheme: true, theme: "dark", lastPlayedKey: null, now: new Date("2026-11-02T12:00:00Z") })).toBeNull();
  });
});

describe("the lamps and the toast", () => {
  it("bloom across the screen one after another, inside it, and never on a price", () => {
    const pins = [{ x: 200, y: 300 }, { x: 80, y: 600 }];
    const lamps = nightFallLamps(390, 844, pins);
    expect(lamps.length).toBeGreaterThan(6);
    for (const lamp of lamps) {
      expect(lamp.x).toBeGreaterThanOrEqual(0);
      expect(lamp.x).toBeLessThanOrEqual(390);
      expect(lamp.y).toBeGreaterThanOrEqual(0);
      expect(lamp.y).toBeLessThanOrEqual(844);
      for (const pin of pins) expect(Math.hypot(lamp.x - pin.x, lamp.y - pin.y)).toBeGreaterThanOrEqual(64);
    }
    const delays = lamps.map((lamp) => lamp.delayMs);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(Math.max(...delays)).toBeLessThan(NIGHT_FALL_MS - 600);
    expect(nightFallLamps(390, 844, pins)).toEqual(lamps);
    expect(nightFallLamps(0, 0)).toEqual([]);
  });

  it("says what really changed, in the house voice, and promises nothing the theme does not do", () => {
    const line = `${NIGHT_FALL_TOAST.time}. ${NIGHT_FALL_TOAST.text}`;
    expect(line).toBe("21:30. Night mode: a darker map until 04:00.");
    expect(line).not.toMatch(/[!—]|bigger|larger/i);
  });
});

describe("the moment on a page", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion = false;
    stubMatchMedia();
    localStorage.clear();
    delete html.dataset.theme;
    delete html.dataset.nightTheme;
    delete html.dataset.themeChosen;
    window.history.replaceState(null, "", "/tonight");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function mount(element: React.ReactElement): Promise<void> {
    await act(async () => {
      root.render(element);
    });
    // The moment starts on the next animation frame.
    await act(async () => {
      vi.advanceTimersByTime(40);
    });
  }

  const overlay = () => document.querySelector('[data-testid="wild-night-fall"]');

  it("plays on the first load after 21:30 that night, then stays quiet", async () => {
    vi.setSystemTime(new Date("2026-11-02T22:15:00Z"));
    html.dataset.theme = "dark";
    html.dataset.nightTheme = "1";
    await mount(createElement(NightFall));
    expect(overlay()).not.toBeNull();
    expect(overlay()!.textContent).toBe("21:30. Night mode: a darker map until 04:00.");
    expect(overlay()!.querySelectorAll(".nightFallLamp").length).toBeGreaterThan(0);
    expect(localStorage.getItem(NIGHT_FALL_STORAGE_KEY)).toBe("2026-11-02");
    await act(async () => {
      vi.advanceTimersByTime(NIGHT_FALL_MS + 200);
    });
    expect(overlay()).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    await mount(createElement(NightFall));
    expect(overlay()).toBeNull();
  });

  it("plays when the night rule turns an open page dark", async () => {
    vi.setSystemTime(new Date("2026-11-02T21:30:00Z"));
    html.dataset.theme = "light";
    await mount(createElement(NightFall));
    expect(overlay()).toBeNull();
    await act(async () => {
      html.dataset.theme = "dark";
      html.dataset.nightTheme = "1";
      await Promise.resolve();
      vi.advanceTimersByTime(40);
    });
    expect(overlay()).not.toBeNull();
  });

  it("never plays for a reader's own dark choice", async () => {
    vi.setSystemTime(new Date("2026-11-02T22:15:00Z"));
    html.dataset.theme = "dark";
    await mount(createElement(NightFall));
    expect(overlay()).toBeNull();
  });

  it("plays on demand with ?nightfall=now and darkens a light page without storing a choice", async () => {
    vi.setSystemTime(new Date("2026-11-02T13:00:00Z"));
    html.dataset.theme = "light";
    window.history.replaceState(null, "", "/map?nightfall=now");
    await mount(createElement(NightFall));
    expect(overlay()).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(html.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(NIGHT_FALL_STORAGE_KEY)).toBeNull();
  });

  it("under reduced motion shows the toast alone, with no lamps", async () => {
    reducedMotion = true;
    vi.setSystemTime(new Date("2026-11-02T22:15:00Z"));
    html.dataset.theme = "dark";
    html.dataset.nightTheme = "1";
    await mount(createElement(NightFall));
    expect(overlay()?.getAttribute("data-reduced")).toBe("true");
    expect(overlay()!.querySelectorAll(".nightFallLamp, .nightFallVeil")).toHaveLength(0);
    expect(overlay()!.querySelector('[role="status"]')?.textContent).toContain("Night mode");
  });

  it("the layout's gate renders nothing while the wild switch is off", async () => {
    vi.setSystemTime(new Date("2026-11-02T22:15:00Z"));
    html.dataset.theme = "dark";
    html.dataset.nightTheme = "1";
    localStorage.removeItem(WILD_MODE_STORAGE_KEY);
    await mount(createElement(NightFallGate));
    expect(container.innerHTML).toBe("");
    expect(overlay()).toBeNull();
  });
});
